import { open, opendir, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, relative, isAbsolute, sep, dirname } from 'node:path';
import { readTitles } from './titles.js';

type JsonObject = Record<string, unknown>;
const object = (v: unknown): JsonObject | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as JsonObject : null;
const integer = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const keys = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
  'output_tokens', 'reasoning_output_tokens', 'total_tokens'] as const;
type Usage = Record<typeof keys[number], number | null>;
const rate = (n: number | null, d: number | null) =>
  n !== null && d !== null && d > 0 && n <= d ? n / d : null;
export const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
const validRef = (ref: string) => /^[a-f0-9]{64}$/.test(ref);
const validTime = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

export function normalizeUsage(value: unknown): Usage {
  const source = object(value) ?? {};
  return Object.fromEntries(keys.map(key => [key, integer(source[key])])) as Usage;
}
export function metrics(info: unknown) {
  const source = object(info) ?? {};
  const last = normalizeUsage(source.last_token_usage);
  const total = normalizeUsage(source.total_token_usage);
  const warnings: string[] = [];
  for (const [label, usage] of [['last', last], ['total', total]] as const) {
    if (usage.input_tokens !== null && usage.cached_input_tokens !== null && usage.cached_input_tokens > usage.input_tokens) {
      usage.cached_input_tokens = null; warnings.push(label + ':cached_exceeds_input');
    }
    if (usage.output_tokens !== null && usage.reasoning_output_tokens !== null && usage.reasoning_output_tokens > usage.output_tokens) {
      usage.reasoning_output_tokens = null; warnings.push(label + ':reasoning_exceeds_output');
    }
  }
  const window = integer(source.model_context_window);
  let context = rate(last.total_tokens, window);
  if (last.input_tokens !== null && last.output_tokens !== null && last.total_tokens !== null
      && last.total_tokens !== last.input_tokens + last.output_tokens) {
    context = null; warnings.push('last:inconsistent_total');
  }
  if (last.total_tokens !== null && window !== null && window > 0 && last.total_tokens > window) warnings.push('last:exceeds_window');
  return { last, total, model_context_window: window,
    last_cache_hit_rate: rate(last.cached_input_tokens, last.input_tokens),
    total_cache_hit_rate: rate(total.cached_input_tokens, total.input_tokens),
    uncached_input_tokens: last.input_tokens !== null && last.cached_input_tokens !== null
      ? last.input_tokens - last.cached_input_tokens : null,
    context_usage_estimate: context, warnings };
}

export class ReaderError extends Error {
  constructor(readonly code: 'invalid_reference' | 'not_found' | 'permission_denied' | 'unsafe_path' | 'invalid_metadata' | 'changed_during_read') { super(code); }
}
type Entry = { session_ref: string; session_id: string; title: string | null; modified_at: string; started_at: string | null; path: string; identity: string; duplicate_records: number };
type Scan = { identity: string; offset: number; anchor: Buffer; partial: Buffer; skipping: boolean; info: ReturnType<typeof metrics> | null;
  observedAt: string | null; compacted: boolean; mtimeMs: number; ctimeMs: number; resetCount: number; ignoredLines: number };
const identity = (s: Stats) => [s.dev, s.ino, s.birthtimeMs].join(':');
const CHUNK = 256 * 1024;
const MAX_LINE = 2 * 1024 * 1024;
const MAX_SCAN = 32 * 1024 * 1024;

export class SessionReader {
  readonly root: string;
  private entries = new Map<string, Entry>();
  private scans = new Map<string, Scan>();
  private inFlight = new Map<string, Promise<ReturnType<SessionReader['snapshot']>>>();
  private catalogPromise: Promise<void> | null = null;
  private catalogAt = 0;
  private availability = 'not_scanned';
  private skippedFiles = 0;
  private titleIndexStatus = 'not_scanned';
  constructor(root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'), private catalogTtl = 10000) { this.root = root; }
  private inside(root: string, path: string) {
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new ReaderError('unsafe_path');
  }
  private async safeOpen(path: string): Promise<FileHandle> {
    const root = await realpath(this.root);
    const before = await realpath(path); this.inside(root, before);
    const file = await open(before, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const after = await realpath(path); this.inside(root, after);
      const [actual, expected] = await Promise.all([file.stat(), stat(after)]);
      if (before !== after || actual.ino !== expected.ino || actual.dev !== expected.dev || !actual.isFile()) throw new ReaderError('unsafe_path');
      return file;
    } catch (error) { await file.close(); throw error; }
  }
  private async *files(dir = this.root): AsyncGenerator<string> {
    for await (const entry of await opendir(dir)) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        try { yield* this.files(path); } catch { this.skippedFiles++; }
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield path;
    }
  }
  private async metadata(file: FileHandle) {
    const chunks: Buffer[] = [];
    for (let position = 0; position < MAX_LINE; position += 65536) {
      const buffer = Buffer.alloc(65536);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead); const newline = chunk.indexOf(10);
      chunks.push(newline >= 0 ? chunk.subarray(0, newline) : chunk);
      if (newline >= 0) {
        const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (event.type !== 'session_meta' || typeof event.payload?.id !== 'string' || !validId(event.payload.id)) break;
        return { id: event.payload.id as string, startedAt: validTime(event.timestamp) };
      }
    }
    throw new ReaderError('invalid_metadata');
  }
  private async refreshCatalog(force: boolean) {
    if (this.catalogPromise) return this.catalogPromise;
    if (!force && Date.now() - this.catalogAt < this.catalogTtl) return;
    this.catalogPromise = (async () => {
      const entries = new Map<string, Entry>(); this.skippedFiles = 0;
      try {
        for await (const path of this.files()) {
          let file: FileHandle | undefined;
          try {
            file = await this.safeOpen(path); const s = await file.stat();
            const ref = createHash('sha256').update(relative(this.root, path).split(sep).join('/')).digest('hex');
            const old = this.entries.get(ref);
            const meta = old?.identity === identity(s) ? { id: old.session_id, startedAt: old.started_at } : await this.metadata(file);
            entries.set(ref, { session_ref: ref, session_id: meta.id, modified_at: s.mtime.toISOString(), started_at: meta.startedAt,
              title: null, path, identity: identity(s), duplicate_records: 1 });
          } catch { this.skippedFiles++; }
          finally { await file?.close(); }
        }
        this.availability = 'ok';
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') this.availability = 'missing_directory';
        else if (code === 'EACCES' || code === 'EPERM') this.availability = 'permission_denied';
        else throw error;
      }
      const titleIndex = await readTitles(dirname(this.root));
      this.titleIndexStatus = titleIndex.status;
      for (const entry of entries.values()) entry.title = titleIndex.titles.get(entry.session_id) ?? null;
      const counts = new Map<string, number>();
      for (const entry of entries.values()) counts.set(entry.session_id, (counts.get(entry.session_id) ?? 0) + 1);
      for (const entry of entries.values()) entry.duplicate_records = counts.get(entry.session_id)!;
      this.entries = entries; this.catalogAt = Date.now();
      for (const ref of this.scans.keys()) if (!entries.has(ref)) this.scans.delete(ref);
    })().finally(() => { this.catalogPromise = null; });
    return this.catalogPromise;
  }
  async list(force = true) {
    await this.refreshCatalog(force);
    return [...this.entries.values()].map(({ path: _path, identity: _identity, ...entry }) => entry)
      .sort((a, b) => b.modified_at.localeCompare(a.modified_at) || a.session_ref.localeCompare(b.session_ref));
  }
  diagnostics() { return { availability: this.availability, skipped_files: this.skippedFiles, title_index_status: this.titleIndexStatus }; }
  private consume(scan: Scan, bytes: Buffer) {
    let start = 0;
    while (start < bytes.length) {
      const end = bytes.indexOf(10, start);
      const piece = bytes.subarray(start, end < 0 ? bytes.length : end);
      if (!scan.skipping) {
        if (scan.partial.length + piece.length > MAX_LINE) { scan.partial = Buffer.alloc(0); scan.skipping = true; scan.ignoredLines++; }
        else scan.partial = scan.partial.length ? Buffer.concat([scan.partial, piece]) : Buffer.from(piece);
      }
      if (end < 0) break;
      if (!scan.skipping) this.event(scan, scan.partial);
      scan.partial = Buffer.alloc(0); scan.skipping = false; start = end + 1;
    }
  }
  private event(scan: Scan, line: Buffer) {
    if (!line.includes('token_count') && !line.includes('compacted') && !line.includes('contextCompaction')) return;
    try {
      const event = JSON.parse(line.toString('utf8'));
      if (event.type === 'compacted' || (event.type === 'event_msg' && ['context_compacted', 'contextCompaction'].includes(event.payload?.type))) scan.compacted = true;
      if (event.type === 'event_msg' && event.payload?.type === 'token_count' && object(event.payload.info)) {
        scan.info = metrics(event.payload.info); scan.observedAt = validTime(event.timestamp); scan.compacted = false;
      }
    } catch { scan.ignoredLines++; }
  }
  private snapshot(entry: Entry, scan: Scan, size: number, bytesRead: number) {
    const data = scan.info ?? metrics(null);
    return { session_ref: entry.session_ref, session_id: entry.session_id, ...data,
      observed_at: scan.observedAt, read_at: new Date().toISOString(),
      status: scan.offset < size ? 'catching_up' : !scan.info ? 'unavailable' : scan.compacted ? 'awaiting_post_compaction' : 'reported',
      source: 'local-rollout', reader: { bytes_read: bytesRead, bytes_processed: scan.offset, file_bytes: size,
        resets: scan.resetCount, ignored_lines: scan.ignoredLines } };
  }
  async get(ref: string) {
    if (!validRef(ref)) throw new ReaderError('invalid_reference');
    const existing = this.inFlight.get(ref); if (existing) return existing;
    const task = this.read(ref).finally(() => { this.inFlight.delete(ref); });
    this.inFlight.set(ref, task); return task;
  }
  private async read(ref: string) {
    await this.refreshCatalog(false);
    let entry = this.entries.get(ref);
    if (!entry) { await this.refreshCatalog(true); entry = this.entries.get(ref); }
    if (!entry) throw new ReaderError('not_found');
    const file = await this.safeOpen(entry.path);
    try {
      const s = await file.stat(); let scan = this.scans.get(ref);
      let changedPrefix = false;
      if (scan && scan.identity === identity(s) && scan.anchor.length && s.size >= scan.offset) {
        const anchor = Buffer.alloc(scan.anchor.length);
        const checked = await file.read(anchor, 0, anchor.length, scan.offset - anchor.length);
        changedPrefix = checked.bytesRead !== anchor.length || !anchor.equals(scan.anchor);
      }
      const reset = !scan || changedPrefix || scan.identity !== identity(s) || s.size < scan.offset
        || (s.size === scan.offset && (s.mtimeMs !== scan.mtimeMs || s.ctimeMs !== scan.ctimeMs));
      if (reset) {
        const metadata = await this.metadata(file);
        entry.session_id = metadata.id; entry.started_at = metadata.startedAt;
        scan = { identity: identity(s), offset: 0, anchor: Buffer.alloc(0), partial: Buffer.alloc(0), skipping: false, info: null,
          observedAt: null, compacted: false, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs,
          resetCount: scan ? scan.resetCount + 1 : 0, ignoredLines: 0 };
        this.scans.set(ref, scan);
      }
      scan = scan!; let read = 0;
      while (scan.offset < s.size && read < MAX_SCAN) {
        const buffer = Buffer.alloc(Math.min(CHUNK, s.size - scan.offset, MAX_SCAN - read));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, scan.offset);
        if (!bytesRead) { this.scans.delete(ref); throw new ReaderError('changed_during_read'); }
        this.consume(scan, buffer.subarray(0, bytesRead)); scan.offset += bytesRead; read += bytesRead;
      }
      const after = await file.stat();
      if (after.size < s.size || (after.size === s.size && (after.mtimeMs !== s.mtimeMs || after.ctimeMs !== s.ctimeMs))) {
        this.scans.delete(ref); throw new ReaderError('changed_during_read');
      }
      scan.anchor = Buffer.alloc(Math.min(256, scan.offset));
      if (scan.anchor.length) await file.read(scan.anchor, 0, scan.anchor.length, scan.offset - scan.anchor.length);
      scan.mtimeMs = s.mtimeMs; scan.ctimeMs = s.ctimeMs;
      return this.snapshot(entry, scan, s.size, read);
    } finally { await file.close(); }
  }
}
