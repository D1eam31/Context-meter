import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const plugin = process.env.CONTEXT_METER_INSTALLED_ROOT || join(homedir(), '.codex/plugins/cache/context-meter-dev/context-meter/0.1.2');
const provenance = JSON.parse(await readFile(join(plugin, 'runtime/provenance.json'), 'utf8'));
assert.equal(createHash('sha256').update(await readFile(join(plugin, 'runtime/node'))).digest('hex'), provenance.runtime_sha256);
const transport = new StdioClientTransport({ command: join(plugin, 'runtime/node'),
  args: [join(plugin, 'dist/server.mjs')], cwd: plugin,
  env: { PATH: '/usr/bin:/bin', CODEX_HOME: process.env.CODEX_HOME || join(homedir(), '.codex') }, stderr: 'pipe' });
const client = new Client({ name: 'context-meter-installed-probe', version: '0.1.2' });
let stderr = ''; transport.stderr?.on('data', chunk => { stderr += String(chunk); });
try {
  await client.connect(transport);
  const tools = await client.listTools(); assert.equal(tools.tools.length, 3);
  const resource = await client.readResource({ uri: 'ui://context-meter/monitor.html' });
  assert.match(resource.contents[0].text, /Context Meter/);
  const opened = await client.callTool({ name: 'open_monitor', arguments: {} });
  const sessions = opened.structuredContent.sessions;
  assert.ok(sessions.length >= 2, 'Two local sessions are required for the live comparison.');
  const root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map(entry => join(entry.parentPath, entry.name));
  const checks = [];
  for (const session of sessions.slice(-2)) {
    let expected;
    for (const file of files) {
      const text = await readFile(file, 'utf8');
      const lines = text.split('\n'); lines.pop();
      if (createHash('sha256').update(relative(root, file).split(sep).join('/')).digest('hex') !== session.session_ref) continue;
      for (const line of lines) {
        if (!line.includes('token_count')) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'event_msg' && event.payload?.type === 'token_count' && event.payload.info) expected = event.payload.info;
        } catch { /* Skip non-complete records in the independent comparison. */ }
      }
      break;
    }
    if (!expected) continue;
    let received;
    for (let batch = 0; batch < 128; batch++) {
      received = await client.callTool({ name: 'get_session_metrics', arguments: { session_ref: session.session_ref } });
      if (received.structuredContent?.status !== 'catching_up') break;
    }
    assert.deepEqual(received.structuredContent.last.input_tokens, expected.last_token_usage.input_tokens);
    assert.deepEqual(received.structuredContent.last.cached_input_tokens, expected.last_token_usage.cached_input_tokens);
    assert.deepEqual(received.structuredContent.total.total_tokens, expected.total_token_usage.total_tokens);
    assert.equal(received.structuredContent.model_context_window, expected.model_context_window);
    checks.push({ latest_input_matches: true, cached_input_matches: true, cumulative_total_matches: true, window_matches: true });
  }
  assert.equal(checks.length, 2);
  assert.equal(stderr, '');
  const output = { recorded_at: new Date().toISOString(), runtime: provenance, node_on_path: false,
    protocol_initialization: 'passed', ui_resource_read: 'passed', local_session_comparisons: checks,
    desktop_ui_render: 'not_verified', browser_refresh_latency: 'not_verified' };
  await writeFile('evidence/installed-probe.json', JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
} finally { await client.close(); }
