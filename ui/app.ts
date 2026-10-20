import { App } from '@modelcontextprotocol/ext-apps';
import { VERSION } from '../src/version.js';
import type { SessionReader } from '../src/reader.js';

type Snapshot = Awaited<ReturnType<SessionReader['get']>>;
type Summary = Awaited<ReturnType<SessionReader['list']>>[number];
const app = new App({ name: 'Context Meter', version: VERSION }, {});
const picker = document.querySelector<HTMLDetailsElement>('#session-picker')!;
const pickerToggle = document.querySelector<HTMLElement>('#session-toggle')!;
const search = document.querySelector<HTMLInputElement>('#session-search')!;
const options = document.querySelector<HTMLElement>('#session-options')!;
let selectedRef = '';
const status = document.querySelector('#status')!;
const error = document.querySelector('#error')!;
const reload = document.querySelector<HTMLButtonElement>('#reload')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!;
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let disposed = false;
let paused = false;
let generation = 0;
let summaries: Summary[] = [];
const percent = (v: number | null) => v !== null ? (v * 100).toFixed(1) + '%' : '不可用';
const number = (v: number | null) => v !== null ? v.toLocaleString('zh-CN') : '不可用';
const time = (v: string | null) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '不可用';
const text = (id: string, value: string) => { document.querySelector(id)!.textContent = value; };

async function call<T>(name: string, args: Record<string, unknown> = {}) {
  const result = await app.callServerTool({ name, arguments: args }, { timeout: 5000 });
  if (result.isError) {
    const message = result.content?.find(item => item.type === 'text');
    throw new Error(message?.type === 'text' ? message.text : '读取失败');
  }
  return result.structuredContent as T;
}
function clear() {
  document.querySelector('#metrics')!.replaceChildren();
  for (const id of ['#context-value', '#last-cache', '#total-cache']) text(id, '—');
  (document.querySelector('#context') as HTMLProgressElement).value = 0;
  text('#detail', ''); text('#updated', '等待所选会话统计');
  text('#context-explanation', '窗口占用根据最近请求估算；多次请求累计消耗可以超过窗口容量。');
}
function selectedLabel() {
  const entry = summaries.find(item => item.session_ref === selectedRef);
  text('#session-title', entry ? entry.title ?? '未命名会话' : '请选择会话');
  text('#selected', entry ? '所选：' + (entry.title ?? '未命名会话') + ' · 记录 ' + entry.session_ref.slice(0, 8) : '尚未选择会话记录');
  text('#identifiers', entry ? '会话标识：' + entry.session_id + ' · 记录引用：' + entry.session_ref : '尚未选择');
}
function renderOptions() {
  const query = search.value.trim().toLocaleLowerCase();
  const matches = summaries.filter(item => [item.title ?? '', item.session_id, item.session_ref].join(' ').toLocaleLowerCase().includes(query));
  options.replaceChildren();
  text('#session-count', matches.length + ' / ' + summaries.length + ' 份记录');
  if (!matches.length) {
    const empty = document.createElement('p'); empty.className = 'muted';
    empty.textContent = summaries.length ? '没有匹配的会话，请尝试标题关键词或标识。' : '暂无本地会话记录。';
    options.append(empty);
  }
  for (const entry of matches) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'session-option';
    button.setAttribute('aria-pressed', String(entry.session_ref === selectedRef));
    const title = document.createElement('span'); title.className = 'option-title'; title.textContent = entry.title ?? '未命名会话';
    const detail = document.createElement('span'); detail.className = 'option-detail';
    detail.textContent = time(entry.modified_at) + ' · 会话 ' + entry.session_id.slice(0, 8) + ' · 记录 ' + entry.session_ref.slice(0, 8)
      + (entry.duplicate_records > 1 ? ' · 同会话 ' + entry.duplicate_records + ' 份记录' : '')
      + (entry.title === null ? ' · 标题元数据不可用' : '');
    button.append(title, detail);
    button.addEventListener('click', () => {
      selectedRef = entry.session_ref; generation++; clear(); selectedLabel(); renderOptions();
      picker.open = false; pickerToggle.focus();
      error.textContent = ''; status.textContent = paused ? '已暂停自动刷新' : '正在读取所选会话记录…';
      void refresh();
    });
    options.append(button);
  }
}
async function list() {
  reload.disabled = true;
  try {
    const data = await call<{ sessions: Summary[]; availability: string; skipped_files: number; title_index_status: string }>('list_sessions');
    if (disposed) return;
    summaries = data.sessions;
    if (!summaries.some(item => item.session_ref === selectedRef)) { selectedRef = ''; generation++; clear(); }
    selectedLabel(); renderOptions();
    text('#title-hint', data.title_index_status === 'available' ? '按标题查找；时间与记录短码用于区分同名或重复记录。'
      : '未读取到可用标题索引；未命名记录仍可通过时间与短码选择。');
    const unavailable = data.availability === 'missing_directory' ? '未找到本地会话目录'
      : data.availability === 'permission_denied' ? '没有会话目录读取权限' : null;
    status.textContent = unavailable ?? '已连接 · ' + summaries.length + ' 份会话记录';
    error.textContent = data.skipped_files ? data.skipped_files + ' 个条目无法读取或格式不受支持。' : '';
  } finally { reload.disabled = false; }
}
function render(data: Snapshot) {
  text('#context-value', percent(data.context_usage_estimate));
  text('#last-cache', percent(data.last_cache_hit_rate));
  text('#total-cache', percent(data.total_cache_hit_rate));
  (document.querySelector('#context') as HTMLProgressElement).value = data.context_usage_estimate ?? 0;
  const rows = document.querySelector('#metrics')!; rows.replaceChildren();
  const uncached = (usage: Snapshot['last']) => usage.input_tokens !== null && usage.cached_input_tokens !== null
    ? usage.input_tokens - usage.cached_input_tokens : null;
  const values: [string, number | null, number | null][] = [
    ['输入', data.last.input_tokens, data.total.input_tokens],
    ['缓存输入', data.last.cached_input_tokens, data.total.cached_input_tokens],
    ['未缓存输入', uncached(data.last), uncached(data.total)],
    ['输出', data.last.output_tokens, data.total.output_tokens],
    ['其中推理输出', data.last.reasoning_output_tokens, data.total.reasoning_output_tokens],
    ['合计（输入 + 输出）', data.last.total_tokens, data.total.total_tokens],
  ];
  for (const [label, latest, cumulative] of values) {
    const row = document.createElement('tr');
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = label;
    const last = document.createElement('td'); last.textContent = number(latest);
    const total = document.createElement('td'); total.textContent = number(cumulative);
    row.append(name, last, total); rows.append(row);
  }
  const messages: Record<string, string> = {
    reported: data.warnings.length ? '部分统计异常，相应指标不可用' : '最近上报统计 · 自动刷新中',
    catching_up: '正在扫描历史，当前统计尚未追平日志',
    awaiting_post_compaction: '已压缩：等待新的统计，当前显示旧值',
    unavailable: '尚无可用统计，等待下一次模型请求上报',
  };
  status.textContent = messages[data.status] ?? '统计不可用';
  text('#context-explanation', '窗口占用估算 = 最近请求合计 ' + number(data.last.total_tokens) + ' ÷ 窗口容量 ' + number(data.model_context_window)
    + ' tokens。多次请求累计消耗可以超过窗口容量。');
  text('#detail', '窗口容量：' + number(data.model_context_window) + ' tokens · 已扫描 ' +
    (data.reader.bytes_processed / 1048576).toFixed(1) + ' / ' + (data.reader.file_bytes / 1048576).toFixed(1) + ' MiB' +
    (data.reader.ignored_lines ? ' · 已跳过 ' + data.reader.ignored_lines + ' 个异常或超长记录' : ''));
  text('#updated', '上报：' + time(data.observed_at) + ' · 读取：' + time(data.read_at));
}
async function refresh() {
  if (disposed || paused || busy || document.hidden || !selectedRef) return;
  busy = true;
  const selected = selectedRef; const current = generation;
  try {
    const data = await call<Snapshot>('get_session_metrics', { session_ref: selected });
    if (disposed || paused || selectedRef !== selected || current !== generation) return;
    render(data); error.textContent = '';
  } catch (e) {
    if (selected === selectedRef && current === generation && !disposed) {
      error.textContent = e instanceof Error ? e.message : '读取失败';
      status.textContent = '连接或读取失败 · 下次轮询重试';
    }
  } finally { busy = false; }
}
search.addEventListener('input', renderOptions);
picker.addEventListener('toggle', () => { if (picker.open) search.focus(); });
picker.addEventListener('keydown', event => {
  if (event.key === 'Escape') { picker.open = false; pickerToggle.focus(); }
  const buttons = [...options.querySelectorAll<HTMLButtonElement>('button')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && buttons.length) {
    event.preventDefault();
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1) + buttons.length) % buttons.length].focus();
  }
});
reload.addEventListener('click', () => void list().catch(e => { error.textContent = String(e); }));
pauseButton.addEventListener('click', () => {
  paused = !paused; generation++;
  pauseButton.textContent = paused ? '继续刷新' : '暂停刷新';
  pauseButton.setAttribute('aria-pressed', String(paused));
  status.textContent = paused ? '已暂停自动刷新' : '恢复刷新…';
  if (!paused) void refresh();
});
const cleanup = () => { disposed = true; generation++; if (timer) clearInterval(timer); };
app.onteardown = async () => { cleanup(); return {}; };
window.addEventListener('pagehide', cleanup);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
app.onhostcontextchanged = context => { if (context.theme) document.documentElement.style.colorScheme = context.theme; };
text('#version', VERSION);
try {
  await app.connect();
  const context = app.getHostContext();
  if (context?.theme) document.documentElement.style.colorScheme = context.theme;
  await list();
  timer = setInterval(() => void refresh(), 2000);
} catch {
  status.textContent = '宿主连接失败';
  error.textContent = '请在支持 MCP Apps 的实际客户端面板中打开，并检查插件是否已启用。';
}
