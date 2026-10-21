import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SessionReader, ReaderError } from './reader.js';
import { VERSION } from './version.js';

const reader = new SessionReader();
const server = new McpServer({ name: 'context-meter', version: VERSION });
const resourceUri = 'ui://context-meter/monitor.html';
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const result = (value: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value,
});
registerAppTool(server, 'open_monitor', {
  title: 'Context Meter',
  description: '打开本地 Codex token 用量与缓存统计面板。用户手动选择会话记录；不会自动识别当前聊天。',
  inputSchema: {}, annotations,
  _meta: { ui: { resourceUri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
}, async () => result({ sessions: await reader.list(), ...reader.diagnostics(), version: VERSION }));
registerAppTool(server, 'list_sessions', {
  description: '列出本地可选会话的标题、标识及修改时间，不返回会话正文或文件路径。',
  inputSchema: {}, annotations,
  _meta: { ui: { resourceUri, visibility: ['app'] } },
}, async () => result({ sessions: await reader.list(), ...reader.diagnostics() }));
registerAppTool(server, 'get_session_metrics', {
  description: '读取用户明确选择的会话统计；用于面板定时刷新，不发送聊天消息。',
  inputSchema: { session_ref: z.string().regex(/^[a-f0-9]{64}$/) }, annotations,
  _meta: { ui: { resourceUri, visibility: ['app'] } },
}, async ({ session_ref }) => {
  try { return result(await reader.get(session_ref)); }
  catch (error) {
    const code = error instanceof ReaderError ? error.code : (error as NodeJS.ErrnoException).code;
    const message = code === 'changed_during_read' ? '日志正在替换或截断，请稍后重试。'
      : code === 'not_found' || code === 'ENOENT' ? '会话记录已移走或删除，请刷新会话列表。'
      : code === 'EACCES' || code === 'EPERM' ? '没有本地日志读取权限。'
      : '无法读取所选会话记录，请刷新列表并检查读取权限。';
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
  }
});
registerAppResource(server, 'Context Meter monitor', resourceUri, {}, async () => ({ contents: [{
  uri: resourceUri, mimeType: RESOURCE_MIME_TYPE,
  text: await readFile(join(__dirname, 'monitor.html'), 'utf8'),
  _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
}] }));
await server.connect(new StdioServerTransport());
