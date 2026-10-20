// Diagnostic use only. The developing plugin/read API is not used by the plugin runtime.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const cli = process.env.CODEX_CLI_PATH || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const child = spawn(cli, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'pipe'] });
const diagnostics = [];
child.stderr.on('data', data => {
  for (const line of String(data).split('\n')) {
    if (/context-meter|plugin MCP|Agent Plugins/.test(line)) diagnostics.push(line);
  }
});
const pending = new Map(); let id = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  try {
    const value = JSON.parse(line);
    if (value.id !== undefined && pending.has(value.id)) {
      const entry = pending.get(value.id); clearTimeout(entry.timeout); pending.delete(value.id);
      value.error ? entry.reject(new Error(JSON.stringify(value.error))) : entry.resolve(value.result);
    }
  } catch { /* Non-protocol output is not treated as a response. */ }
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const key = ++id;
  const timeout = setTimeout(() => { pending.delete(key); reject(new Error(`${method}: timed out`)); }, 15000);
  pending.set(key, { resolve, reject, timeout });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: key, method, params }) + '\n');
});
try {
  const initialized = await rpc('initialize', { clientInfo: { name: 'context-meter-diagnostic', version: '0.1.2' },
    capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
  const detail = await rpc('plugin/read', { marketplacePath: resolve('../../outputs/context-meter-local/.agents/plugins/marketplace.json'), pluginName: 'context-meter' });
  const status = detail.plugin.mcpServers.includes('context-meter')
    ? await rpc('mcpServerStatus/list', { serverName: 'context-meter', detail: 'full' }) : null;
  const output = { recorded_at: new Date().toISOString(), userAgent: initialized.userAgent,
    plugin: { marketplaceName: detail.plugin.marketplaceName, mcpServers: detail.plugin.mcpServers,
      skills: detail.plugin.skills.map(skill => skill.name), summary: detail.plugin.summary },
    mcp_status: status, diagnostics, note: 'Independent app-server discovery only; not desktop UI validation.' };
  console.log(JSON.stringify(output, null, 2));
  await writeFile('evidence/host-discovery.json', JSON.stringify(output, null, 2) + '\n');
} finally { child.kill(); lines.close(); }
