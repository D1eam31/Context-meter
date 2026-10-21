import { cp, copyFile, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';

const { values } = parseArgs({ options: {
  target: { type: 'string', default: process.platform + '-' + process.arch },
  output: { type: 'string', default: 'build/packages' }, archive: { type: 'boolean', default: false },
} });
const target = values.target;
if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target)) throw new Error('Unsupported target: ' + target);
if (process.version !== 'v24.22.0') throw new Error('Run packaging with mise Node 24.22.0.');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const output = resolve(values.output);
const stage = resolve('build/stage', target);
await rm(stage, { recursive: true, force: true });
const plugin = join(stage, 'context-meter');
await mkdir(join(plugin, 'runtime'), { recursive: true });
for (const directory of ['dist', 'skills', 'assets', 'docs']) await cp(directory, join(plugin, directory), { recursive: true });
for (const file of ['README.md', 'LICENSE']) await copyFile(file, join(plugin, file));
const manifest = JSON.parse(await readFile('plugin.json', 'utf8'));
manifest.version = pkg.version;
const mcp = JSON.parse(await readFile('mcp.json', 'utf8'));
const binary = target.startsWith('win32') ? 'node.exe' : 'node';
mcp.mcpServers['context-meter'].command = './runtime/' + binary;
await writeFile(join(plugin, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(plugin, 'mcp.json'), JSON.stringify(mcp, null, 2) + '\n');
// Codex's documented compatibility manifest provides the env_vars forwarding absent from portable stdio config.
await mkdir(join(plugin, '.codex-plugin'), { recursive: true });
await writeFile(join(plugin, '.codex-plugin/plugin.json'), JSON.stringify({
  name: manifest.name, version: pkg.version, description: manifest.description,
  ...manifest.extensions['com.openai'], skills: './skills/',
  mcpServers: { 'context-meter': { command: './runtime/' + binary, cwd: '.',
    args: ['${PLUGIN_ROOT}/dist/server.mjs'], env_vars: ['CODEX_HOME'] } },
}, null, 2) + '\n');
const destination = join(plugin, 'runtime', binary);
let archiveChecksum = null;
const upstreamTarget = target.replace('win32', 'win');
const extension = target.startsWith('win32') ? '.zip' : '.tar.gz';
const filename = 'node-v24.22.0-' + upstreamTarget + extension;
const archivePath = resolve('build/downloads', filename);
if (target === process.platform + '-' + process.arch) {
  await copyFile(process.execPath, destination);
  const license = target.startsWith('win32') ? join(dirname(process.execPath), 'LICENSE') : resolve(dirname(process.execPath), '../LICENSE');
  await copyFile(license, join(plugin, 'runtime/NODE-LICENSE'));
} else {
  const lock = await readFile('mise.lock', 'utf8');
  const platform = target.replace('darwin', 'macos').replace('win32', 'windows');
  const section = lock.split('[tools.node."platforms.' + platform + '"]')[1]?.split('\n[')[0];
  const expected = section?.match(/checksum = "sha256:([a-f0-9]+)"/)?.[1];
  if (!expected) throw new Error('Missing locked archive checksum for ' + platform);
  archiveChecksum = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  if (archiveChecksum !== expected) throw new Error('Archive checksum mismatch: ' + filename);
  const prefix = 'node-v24.22.0-' + upstreamTarget;
  if (target.startsWith('win32')) {
    for (const [member, outputName] of [['node.exe', binary], ['LICENSE', 'NODE-LICENSE']]) {
      const fd = openSync(join(plugin, 'runtime', outputName), 'w');
      try { execFileSync('/usr/bin/unzip', ['-p', archivePath, prefix + '/' + member], { stdio: ['ignore', fd, 'pipe'] }); }
      finally { closeSync(fd); }
    }
  } else {
    const extracted = resolve('build/extracted', target); await mkdir(extracted, { recursive: true });
    execFileSync('/usr/bin/tar', ['-xzf', archivePath, '-C', extracted, prefix + '/bin/node', prefix + '/LICENSE']);
    await copyFile(join(extracted, prefix, 'bin/node'), destination);
    await copyFile(join(extracted, prefix, 'LICENSE'), join(plugin, 'runtime/NODE-LICENSE'));
  }
}
await chmod(destination, 0o755);
const bytes = await readFile(destination);
const magic = bytes.subarray(0, 4).toString('hex');
if (target.startsWith('win32') ? bytes.subarray(0, 2).toString() !== 'MZ' : !['cffaedfe', 'cafebabe', 'bebafeca'].includes(magic)) throw new Error('Wrong runtime binary format.');
if (target.startsWith('win32')) {
  const offset = bytes.readUInt32LE(0x3c);
  if (bytes.subarray(offset, offset + 4).toString('hex') !== '50450000' || bytes.readUInt16LE(offset + 4) !== 0x8664) throw new Error('Expected Windows x64 PE runtime.');
} else if (magic === 'cffaedfe' && bytes.readUInt32LE(4) !== (target.endsWith('arm64') ? 0x100000c : 0x1000007)) throw new Error('Wrong Mach-O CPU architecture.');
const provenance = { version: pkg.version, node: 'v24.22.0', target, runtime_sha256: createHash('sha256').update(bytes).digest('hex'),
  source: 'https://nodejs.org/dist/v24.22.0/' + filename, archive_sha256: archiveChecksum,
  source_installation: target === process.platform + '-' + process.arch ? 'mise core:node@24.22.0' : 'official archive verified against mise.lock',
  execution_verified: target === process.platform + '-' + process.arch
    ? execFileSync(destination, ['--version'], { encoding: 'utf8' }).trim() === 'v24.22.0' : false,
  desktop_ui_automatically_verified: false };
await writeFile(join(plugin, 'runtime/provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
const ajv = new Ajv2020({ strict: false, allErrors: true });
for (const name of ['plugin', 'mcp']) {
  const validate = ajv.compile(JSON.parse(await readFile('schemas/' + name + '.schema.json', 'utf8')));
  if (!validate(JSON.parse(await readFile(join(plugin, name + '.json'), 'utf8')))) throw new Error(JSON.stringify(validate.errors));
}
await mkdir(output, { recursive: true });
const final = join(output, 'context-meter-' + pkg.version + '-' + target);
await rm(final, { recursive: true, force: true });
await cp(plugin, final, { recursive: true });
if (values.archive) {
  if (process.platform === 'win32') throw new Error('ZIP export is currently run on macOS/Linux build hosts.');
  const zipPath = final + '.zip'; await rm(zipPath, { force: true });
  execFileSync('/usr/bin/zip', ['-q', '-r', zipPath, 'context-meter'], { cwd: stage });
  execFileSync('/usr/bin/unzip', ['-tq', zipPath], { stdio: 'pipe' });
  const hash = createHash('sha256').update(await readFile(zipPath)).digest('hex');
  await writeFile(zipPath + '.sha256', hash + '  ' + zipPath.split('/').pop() + '\n');
}
console.log(JSON.stringify({ target, package: final, provenance }, null, 2));
