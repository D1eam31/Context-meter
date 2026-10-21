import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import sharp from 'sharp';

await mkdir('dist', { recursive: true });
for (const [size, name] of [[256, 'icon.png'], [48, 'composer-icon.png']]) {
  await sharp(await readFile('assets/icon.svg')).resize(size, size).png().toFile('assets/' + name);
}
const ui = await build({ entryPoints: ['ui/app.ts'], bundle: true, format: 'esm', target: 'es2022', write: false, metafile: true });
const template = await readFile('ui/monitor.html', 'utf8');
await writeFile('dist/monitor.html', template.replace('/* CONTEXT_METER_APP */', () => ui.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')));
const server = await build({ entryPoints: ['src/server.ts'], bundle: true, platform: 'node', target: 'node24', format: 'esm', metafile: true,
  outfile: 'dist/server.mjs', banner: { js: 'import { createRequire as __cmCreateRequire } from "node:module"; import { fileURLToPath as __cmFileURLToPath } from "node:url"; const require = __cmCreateRequire(import.meta.url); const __dirname = __cmFileURLToPath(new URL(".", import.meta.url));' } });
await build({ entryPoints: ['src/reader.ts'], bundle: true, platform: 'node', target: 'node24', format: 'esm', outfile: 'dist/reader.mjs' });
const notices = new Map();
for (const input of Object.keys({ ...ui.metafile.inputs, ...server.metafile.inputs })) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(input));
  while (directory.includes('node_modules')) {
    try {
      const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (pkg.name) {
        const licenses = (await readdir(directory)).filter(name => /^(license|licence|copying)(\..*)?$/i.test(name));
        notices.set(pkg.name, [pkg.name + '@' + pkg.version + ' (' + (pkg.license ?? 'see package') + ')',
          ...await Promise.all(licenses.map(name => readFile(join(directory, name), 'utf8')))].join('\n'));
        break;
      }
    } catch { /* Continue to the containing package for source subdirectories. */ }
    const parent = dirname(directory); if (parent === directory) break; directory = parent;
  }
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt', [...notices.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,text])=>text).join('\n\n-----\n\n') + '\n');
console.log('Built self-contained MCP server and UI; recorded ' + notices.size + ' dependency notices.');
