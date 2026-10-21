import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';

const root = resolve(process.argv[2] || 'build/packages/context-meter-0.1.2-' + process.platform + '-' + process.arch);
const provenance = JSON.parse(await readFile(join(root, 'runtime/provenance.json'), 'utf8'));
assert.equal(provenance.target, process.platform + '-' + process.arch, 'Run this check on the matching target system.');
const runtime = join(root, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
assert.equal(createHash('sha256').update(await readFile(runtime)).digest('hex'), provenance.runtime_sha256);
const home = await mkdtemp(join(tmpdir(), 'context-meter-打包验证 空格-'));
await mkdir(join(home, 'sessions'));
const event = input => JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'token_count', info: {
  last_token_usage: { input_tokens: input, cached_input_tokens: 50, output_tokens: 10, reasoning_output_tokens: 5, total_tokens: input + 10 },
  total_token_usage: { input_tokens: input * 3, cached_input_tokens: 100, output_tokens: 30, total_tokens: input * 3 + 30 }, model_context_window: 1000 } } }) + '\n';
for (const [id, input] of [['native-one', 100], ['native-two', 200]]) {
  await writeFile(join(home, 'sessions', id + '.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n' + event(input));
}
await writeFile(join(home, 'session_index.jsonl'), JSON.stringify({ id: 'native-one', thread_name: '打包验证会话', updated_at: new Date().toISOString() }) + '\n');
const transport = new StdioClientTransport({ command: runtime, args: [join(root, 'dist/server.mjs')], cwd: root,
  env: { CODEX_HOME: home, PATH: process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\Windows') + '\\System32' : '/usr/bin:/bin' }, stderr: 'pipe' });
const client = new Client({ name: 'context-meter-package-check', version: '0.1.2' });
try {
  await client.connect(transport);
  const tools = await client.listTools(); assert.equal(tools.tools.length, 3);
  const resource = await client.readResource({ uri: 'ui://context-meter/monitor.html' });
  assert.match(resource.contents[0].text, /Context Meter/);
  const open = await client.callTool({ name: 'open_monitor', arguments: {} });
  assert.equal(open.structuredContent.version, '0.1.2');
  assert.equal(open.structuredContent.sessions.length, 2);
  const selected = open.structuredContent.sessions.find(s => s.session_id === 'native-one');
  assert.equal(selected.title, '打包验证会话');
  const read = () => client.callTool({ name: 'get_session_metrics', arguments: { session_ref: selected.session_ref } });
  assert.equal((await read()).structuredContent.last.input_tokens, 100);
  const start = performance.now();
  await appendFile(join(home, 'sessions/native-one.jsonl'), event(300));
  await setTimeout(2000);
  const refreshed = await read(); assert.equal(refreshed.structuredContent.last.input_tokens, 300);
  const elapsed = performance.now() - start; assert.ok(elapsed < 3000);
  const output = { recorded_at: new Date().toISOString(), version: '0.1.2', target: provenance.target,
    runtime_checksum: 'passed', system_node_python_on_path: false, protocol: 'passed', ui_resource: 'passed',
    explicit_session_selection: 'passed', session_title: 'passed', custom_codex_home: 'passed', poll_cadence_test_ms: Math.round(elapsed),
    poll_cadence_test: '2-second wait plus MCP read; not a browser rendering measurement', desktop_ui: 'not_automatically_verified' };
  await mkdir('evidence', { recursive: true });
  await writeFile('evidence/package-check-' + provenance.target + '.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally { await client.close(); await rm(home, { recursive: true, force: true }); }
