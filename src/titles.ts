import { open, realpath, lstat, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const MAX_INDEX = 8 * 1024 * 1024;
const MAX_LINE = 16 * 1024;

// This optional local metadata file is version-dependent, like the rollout format.
// Never fall back to prompts, database access, or arbitrary file paths for a title.
export async function readTitles(home: string) {
  const titles = new Map<string, string>();
  let status: 'available' | 'missing' | 'unavailable' | 'too_large' = 'unavailable';
  let file;
  try {
    const root = await realpath(home);
    const path = join(root, 'session_index.jsonl');
    const link = await lstat(path);
    if (!link.isFile() || link.isSymbolicLink() || await realpath(path) !== path) return { titles, status };
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await file.stat();
    const expected = await stat(path);
    if (!before.isFile() || before.ino !== expected.ino || before.dev !== expected.dev) return { titles, status };
    if (before.size > MAX_INDEX) return { titles, status: 'too_large' as const };
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) return { titles, status };
      offset += read.bytesRead;
    }
    const after = await file.stat();
    if (after.size < before.size || (after.size === before.size && (after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs))
        || (await lstat(path)).isSymbolicLink() || await realpath(path) !== path) return { titles, status };
    const final = await stat(path);
    if (before.ino !== final.ino || before.dev !== final.dev) return { titles, status };
    const timestamps = new Map<string, number>();
    let start = 0;
    while (start < bytes.length) {
      const end = bytes.indexOf(10, start);
      if (end < 0) break; // An in-progress last line is not metadata yet.
      if (end - start <= MAX_LINE) {
        try {
          const row = JSON.parse(bytes.subarray(start, end).toString('utf8'));
          if (typeof row.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(row.id)
              && typeof row.thread_name === 'string' && typeof row.updated_at === 'string') {
            const updated = Date.parse(row.updated_at);
            if (Number.isFinite(updated) && updated >= (timestamps.get(row.id) ?? -Infinity)) {
              const title = Array.from(row.thread_name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 160).join('');
              timestamps.set(row.id, updated);
              if (title) titles.set(row.id, title); else titles.delete(row.id);
            }
          }
        } catch { /* Unknown or malformed metadata does not block token monitoring. */ }
      }
      start = end + 1;
    }
    status = 'available';
  } catch (error) {
    status = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable';
  } finally { await file?.close(); }
  return { titles, status };
}
