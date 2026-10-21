import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, symlink, rename, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { SessionReader, metrics } from '../dist/reader.mjs';

const usage = (input = 100, cached = 80) => ({ input_tokens: input, cached_input_tokens: cached,
  output_tokens: 20, reasoning_output_tokens: 5, total_tokens: input + 20 });
const header = id => JSON.stringify({ type: 'session_meta', timestamp: '2026-10-19T13:00:00Z', payload: { id } }) + '\n';
const event = (input = 100, cached = 80) => JSON.stringify({ type: 'event_msg', timestamp: '2026-10-19T13:00:00Z',
  payload: { type: 'token_count', info: { last_token_usage: usage(input, cached),
    total_token_usage: usage(input * 3, cached * 3), model_context_window: 1000 } } }) + '\n';
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'context-meter-中文 空格-'));
  const root = join(home, 'sessions'); await mkdir(root);
  for (const id of ['session-one', 'session-two']) await writeFile(join(root, id + '.jsonl'), header(id) + event(id === 'session-one' ? 100 : 200));
  t.after(() => rm(home, { recursive: true, force: true }));
  const reader = new SessionReader(root);
  const refs = Object.fromEntries((await reader.list()).map(s => [s.session_id, s.session_ref]));
  return { home, root, reader, refs };
}
test('latest and weighted cumulative cache rates are independent of context size', () => {
  const data = metrics({ last_token_usage: usage(), total_token_usage: usage(1000, 500), model_context_window: 1000 });
  assert.equal(data.last_cache_hit_rate, .8); assert.equal(data.total_cache_hit_rate, .5);
  assert.equal(data.context_usage_estimate, .12); assert.equal(data.uncached_input_tokens, 20);
  assert.equal(data.last.output_tokens, 20); // Reasoning is already part of output.
});
test('missing, zero denominators, invalid and contradictory counts are unavailable', () => {
  assert.equal(metrics(null).context_usage_estimate, null);
  assert.equal(metrics({ last_token_usage: usage(0, 0) }).last_cache_hit_rate, null);
  assert.equal(metrics({ last_token_usage: usage(100, 101) }).uncached_input_tokens, null);
  assert.equal(metrics({ last_token_usage: usage(-1, 0) }).last.input_tokens, null);
  assert.equal(metrics({ last_token_usage: usage(100, 0) }).last_cache_hit_rate, 0);
  assert.equal(metrics({ last_token_usage: { ...usage(), total_tokens: 999 }, model_context_window: 1000 }).context_usage_estimate, null);
  assert.equal(metrics({ last_token_usage: { ...usage(), reasoning_output_tokens: 21 } }).last.reasoning_output_tokens, null);
  assert.equal(metrics({ last_token_usage: usage(2000), model_context_window: 1000 }).context_usage_estimate, null);
});
test('cumulative consumption can exceed capacity without inflating context occupancy', () => {
  const data = metrics({ last_token_usage: { input_tokens: 302810, cached_input_tokens: 301312, output_tokens: 364, reasoning_output_tokens: 262, total_tokens: 303174 },
    total_token_usage: { input_tokens: 16243449, output_tokens: 94200, total_tokens: 16337649 }, model_context_window: 475000 });
  assert.equal((data.context_usage_estimate * 100).toFixed(1), '63.8');
  assert.equal(data.total.total_tokens, 16337649); assert.deepEqual(data.warnings, []);
});
test('titles use explicit metadata; renamed and duplicate records retain independent references', async t => {
  const {reader, root, home} = await fixture(t);
  const row = (name, date = '2026-10-20T00:00:00Z') => JSON.stringify({id:'session-one',thread_name:name,updated_at:date}) + '\n';
  const index = join(home,'session_index.jsonl');
  await writeFile(index, row('旧标题', '2026-10-19T00:00:00Z') + row('开发上下文监控插件') + row('过期标题', '2026-10-18T00:00:00Z'));
  await writeFile(join(root,'duplicate.jsonl'),header('session-one') + event(900,800));
  const before = createHash('sha256').update(await readFile(index)).digest('hex');
  const entries = (await reader.list()).filter(s=>s.session_id==='session-one');
  assert.equal(entries.length,2); assert.ok(entries.every(s=>s.title==='开发上下文监控插件'));
  assert.notEqual(entries[0].session_ref, entries[1].session_ref);
  assert.equal((await reader.list()).find(s=>s.session_id==='session-two').title,null);
  assert.equal(createHash('sha256').update(await readFile(index)).digest('hex'),before);
  await appendFile(index,row('重命名后的会话','2026-10-21T00:00:00Z'));
  assert.ok((await reader.list()).filter(s=>s.session_id==='session-one').every(s=>s.title==='重命名后的会话'));
  await writeFile(index,row('替换后的标题'));
  assert.equal((await reader.list()).find(s=>s.session_id==='session-one').title,'替换后的标题');
});
test('missing, malformed and partial title metadata do not leak prompts or stop monitoring', async t => {
  const {reader, root, home, refs} = await fixture(t);
  assert.equal(reader.diagnostics().title_index_status,'missing');
  await appendFile(join(root,'session-two.jsonl'),JSON.stringify({type:'response_item',payload:{role:'user',content:[{text:'PRIVATE PROMPT MUST NOT BECOME TITLE'}]}})+'\n');
  const index=join(home,'session_index.jsonl');
  await writeFile(index,'broken\n'+JSON.stringify({id:'session-one',thread_name:'\u202e 中文\n标题 ',updated_at:'2026-10-20T00:00:00Z'})+'\n'+JSON.stringify({id:'session-two',thread_name:'半行',updated_at:'2026-10-20T00:00:00Z'}));
  const entries=await reader.list();
  assert.equal(entries.find(s=>s.session_id==='session-one').title,'中文 标题');
  assert.equal(entries.find(s=>s.session_id==='session-two').title,null);
  assert.equal(JSON.stringify(entries).includes('PRIVATE PROMPT'),false);
  assert.equal((await reader.get(refs['session-two'])).last.input_tokens,200);
  await appendFile(index,'\n');
  assert.equal((await reader.list()).find(s=>s.session_id==='session-two').title,'半行');
  await rm(index);assert.ok((await reader.list()).every(s=>s.title===null));
});
test('oversized title indexes fall back without allocating unbounded metadata', async t => {
  const {reader,home,refs}=await fixture(t);
  await writeFile(join(home,'session_index.jsonl'),'x'.repeat(8*1048576+1));
  assert.ok((await reader.list()).every(s=>s.title===null));
  assert.equal(reader.diagnostics().title_index_status,'too_large');
  assert.equal((await reader.get(refs['session-one'])).last.input_tokens,100);
});
test('title index symlinks cannot read metadata outside CODEX_HOME', {skip:process.platform==='win32' ? 'Requires Windows developer-mode symlink permission' : false}, async t => {
  const {reader,home,root}=await fixture(t);
  const outside=join(root,'private-index');
  await writeFile(outside,JSON.stringify({id:'session-one',thread_name:'PRIVATE',updated_at:'2026-10-20T00:00:00Z'})+'\n');
  await symlink(outside,join(home,'session_index.jsonl'));
  assert.ok((await reader.list()).every(s=>s.title===null));
  assert.equal(reader.diagnostics().title_index_status,'unavailable');
});
test('explicit record selection isolates sessions without exposing paths or content', async t => {
  const { reader, refs } = await fixture(t);
  assert.equal((await reader.get(refs['session-one'])).last.input_tokens, 100);
  assert.equal((await reader.get(refs['session-two'])).last.input_tokens, 200);
  const list = await reader.list();
  assert.ok(list.every(s => /^[a-f0-9]{64}$/.test(s.session_ref)));
  assert.equal(JSON.stringify(list).includes('path'), false);
  await assert.rejects(reader.get('../secret'), /invalid_reference/);
  await assert.rejects(reader.get('a'.repeat(64)), /not_found/);
});
test('duplicate session IDs remain selectable as separate records', async t => {
  const { reader, root } = await fixture(t);
  await writeFile(join(root, 'duplicate.jsonl'), header('session-one') + event(900, 800));
  const matching = (await reader.list()).filter(s => s.session_id === 'session-one');
  assert.equal(matching.length, 2); assert.ok(matching.every(s => s.duplicate_records === 2));
  const inputs = await Promise.all(matching.map(async s => (await reader.get(s.session_ref)).last.input_tokens));
  assert.deepEqual(inputs.sort((a,b) => a-b), [100, 900]);
});
test('idle polling scans zero new bytes; partial append waits for newline', async t => {
  const { reader, root, refs } = await fixture(t);
  const ref = refs['session-one']; const file = join(root, 'session-one.jsonl');
  await reader.get(ref);
  assert.equal((await reader.get(ref)).reader.bytes_read, 0);
  const next = event(500, 400);
  await appendFile(file, next.slice(0, -1));
  const partial = await reader.get(ref);
  assert.equal(partial.last.input_tokens, 100);
  assert.equal(partial.reader.bytes_read, Buffer.byteLength(next) - 1);
  await appendFile(file, '\n');
  const complete = await reader.get(ref);
  assert.equal(complete.last.input_tokens, 500); assert.equal(complete.reader.bytes_read, 1);
});
test('truncation resets incremental state', async t => {
  const { reader, root, refs } = await fixture(t);
  const ref = refs['session-one']; await reader.get(ref);
  await writeFile(join(root, 'session-one.jsonl'), header('session-one'));
  const data = await reader.get(ref);
  assert.equal(data.status, 'unavailable'); assert.equal(data.last.input_tokens, null); assert.equal(data.reader.resets, 1);
});
test('atomic file replacement resets the same opaque record reference', async t => {
  const { reader, root, refs } = await fixture(t);
  const ref = refs['session-one']; await reader.get(ref);
  await writeFile(join(root, 'replacement.tmp'), header('session-one') + event(700, 600));
  await rename(join(root, 'replacement.tmp'), join(root, 'session-one.jsonl'));
  const data = await reader.get(ref);
  assert.equal(data.last.input_tokens, 700); assert.equal(data.reader.resets, 1);
});
test('truncate-and-rewrite with growth invalidates cached usage', async t => {
  const { reader, root, refs } = await fixture(t);
  const ref = refs['session-one']; await reader.get(ref);
  const file = join(root, 'session-one.jsonl');
  await writeFile(file, header('session-one') + event(400, 80));
  const future = new Date(Date.now() + 10000); await utimes(file, future, future);
  assert.equal((await reader.get(ref)).last.input_tokens, 400);
});
test('duplicate events do not accumulate usage; compaction marks old values', async t => {
  const { reader, root, refs } = await fixture(t);
  const ref = refs['session-one']; await reader.get(ref);
  const file = join(root, 'session-one.jsonl');
  await appendFile(file, event() + JSON.stringify({ type: 'compacted' }) + '\n');
  const data = await reader.get(ref);
  assert.equal(data.total.input_tokens, 300); assert.equal(data.status, 'awaiting_post_compaction');
  await appendFile(file, event(50, 0));
  assert.equal((await reader.get(ref)).status, 'reported');
});
test('large image-like records are skipped with bounded buffers; following usage is read', async t => {
  const { reader, root, refs } = await fixture(t);
  const file = join(root, 'session-one.jsonl'); const ref = refs['session-one'];
  await appendFile(file, '{"type":"image","data":"' + 'a'.repeat(3 * 1048576) + '"}\n' + event(600, 500));
  const data = await reader.get(ref);
  assert.equal(data.last.input_tokens, 600); assert.equal(data.reader.ignored_lines, 1);
});
test('large histories expose catch-up state and resume without rescanning', async t => {
  const { reader, root, refs } = await fixture(t);
  const file = join(root, 'session-one.jsonl'); const ref = refs['session-one'];
  await appendFile(file, '{"type":"image","data":"');
  for(let i=0;i<34;i++) await appendFile(file, 'x'.repeat(1048576));
  await appendFile(file, '"}\n' + event(800, 700));
  const first = await reader.get(ref);
  assert.equal(first.status, 'catching_up'); assert.equal(first.reader.bytes_read, 32 * 1048576);
  const second = await reader.get(ref);
  assert.equal(second.status, 'reported'); assert.equal(second.last.input_tokens, 800);
  assert.ok(second.reader.bytes_read < 3 * 1048576);
});
test('simultaneous polls share a scan and never double count bytes', async t => {
  const { reader, refs } = await fixture(t);
  const [a,b] = await Promise.all([reader.get(refs['session-one']),reader.get(refs['session-one'])]);
  assert.deepEqual(a,b); assert.equal((await reader.get(refs['session-one'])).reader.bytes_read,0);
});
test('outside file and directory symlinks cannot supply data', {skip:process.platform==='win32' ? 'Requires Windows developer-mode symlink permission' : false}, async t => {
  const { reader, root, home } = await fixture(t);
  const outside = join(home, 'outside'); await mkdir(outside);
  await writeFile(join(outside, 'private.jsonl'), header('private') + event(900,800));
  await symlink(join(outside,'private.jsonl'),join(root,'escape.jsonl'));
  const nested=join(root,'nested'); await mkdir(nested);
  await writeFile(join(nested,'file.jsonl'),header('nested')+event());
  const entry=(await reader.list()).find(s=>s.session_id==='nested');
  await rename(nested,join(root,'nested-old'));
  await symlink(outside,nested);
  await assert.rejects(reader.get(entry.session_ref));
  assert.equal((await reader.list()).some(s=>s.session_id==='private'),false);
});
test('unknown events and invalid JSON do not alter statistics or write logs', async t => {
  const { reader, root, refs } = await fixture(t);
  const file=join(root,'session-one.jsonl');
  await appendFile(file,'not-json-token_count\n'+JSON.stringify({type:'event_msg',payload:{type:'other',text:'token_count'}})+'\n');
  const before=createHash('sha256').update(await readFile(file)).digest('hex');
  const data=await reader.get(refs['session-one']);
  assert.equal(data.last.input_tokens,100);assert.equal(data.reader.ignored_lines,1);
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),before);
});
test('missing directories report absence; removed records fail without stale output', async t => {
  const {reader,root,refs}=await fixture(t);
  await reader.get(refs['session-one']);
  await rm(join(root,'session-one.jsonl'));
  await assert.rejects(reader.get(refs['session-one']));
  const absent=new SessionReader(join(root,'missing'));
  assert.deepEqual(await absent.list(),[]);assert.equal(absent.diagnostics().availability,'missing_directory');
});
test('official stdio client initializes, discovers App metadata and uses opaque references', async t => {
  const {home,root,refs}=await fixture(t);
  await writeFile(join(home,'session_index.jsonl'),JSON.stringify({id:'session-one',thread_name:'协议测试会话',updated_at:'2026-10-20T00:00:00Z'})+'\n');
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/server.mjs')],
    env:{CODEX_HOME:home,PATH:process.platform==='win32'?'C:\\Windows\\System32':'/usr/bin:/bin'},stderr:'pipe'});
  let stderr='';transport.stderr?.on('data',d=>stderr+=String(d));
  const client=new Client({name:'context-meter-integration-test',version:'0.1.2'});t.after(()=>client.close());
  await client.connect(transport);
  const tools=(await client.listTools()).tools;
  assert.equal(tools.length,3);
  assert.deepEqual(tools.find(t=>t.name==='open_monitor')._meta['openai/ui'].entrypoints,[{type:'thread'}]);
  assert.deepEqual(tools.find(t=>t.name==='get_session_metrics')._meta.ui.visibility,['app']);
  assert.equal((await client.listResources()).resources.length,1);
  const resource=await client.readResource({uri:'ui://context-meter/monitor.html'});
  assert.match(resource.contents[0].mimeType,/text\/html/);assert.match(resource.contents[0].text,/Context Meter/);
  const opened=await client.callTool({name:'open_monitor',arguments:{}});
  assert.equal(opened.structuredContent.sessions.length,2);
  assert.equal(opened.structuredContent.sessions.find(s=>s.session_id==='session-one').title,'协议测试会话');
  const read=async ref=>(await client.callTool({name:'get_session_metrics',arguments:{session_ref:ref}})).structuredContent;
  assert.equal((await read(refs['session-one'])).last.input_tokens,100);
  assert.equal((await read(refs['session-two'])).last.input_tokens,200);
  const start=performance.now();await appendFile(join(root,'session-one.jsonl'),event(300,200));
  assert.equal((await read(refs['session-one'])).last.input_tokens,300);
  assert.ok(performance.now()-start<3000);
  const invalid=await client.callTool({name:'get_session_metrics',arguments:{session_ref:'../private'}});
  assert.equal(invalid.isError,true);assert.equal(stderr,'');
});
test('portable manifests validate against downloaded official schemas and match package version', async () => {
  const ajv=new Ajv2020({strict:false,allErrors:true});
  for(const name of ['plugin','mcp']){
    const schema=JSON.parse(await readFile('schemas/'+name+'.schema.json','utf8'));
    const data=JSON.parse(await readFile(name+'.json','utf8'));
    const validate=ajv.compile(schema);
    assert.equal(validate(data),true,JSON.stringify(validate.errors));
  }
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  const manifest=JSON.parse(await readFile('plugin.json','utf8'));
  assert.equal(pkg.version,manifest.version);
  assert.equal(pkg.license,'MIT');assert.equal(manifest.license,'MIT');
  const license=await readFile('LICENSE','utf8');
  assert.match(license,/^MIT License\r?\n/);assert.match(license,/Copyright \(c\) 2026 Context Meter contributors/);
});
