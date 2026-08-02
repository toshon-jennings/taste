import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { describe } from './diff.mjs';
import { projectRoot } from './paths.mjs';

/**
 * The loudest taste signal there is: Claude wrote something, and you rewrote it.
 *
 * When Claude writes a file we snapshot exactly what it wrote. Later — at the
 * next prompt, or the next session — we compare the snapshot against what is on
 * disk. A difference means someone changed it by hand, and the diff of that
 * change is a direct statement of preference: the rename you made, the comment
 * you deleted, the nesting you flattened.
 *
 * Detection is lazy rather than watched: a comparison at prompt time costs one
 * hash per tracked file and needs no filesystem watcher, no daemon, and no
 * matcher patterns. Claude's own later edits re-snapshot the file, so they never
 * masquerade as your corrections.
 */

const MAX_TRACKED = 50;
const MAX_BYTES = 256 * 1024;

/** Never snapshot these, even though they already sit in the project. */
const SENSITIVE = /(^|\/)\.env|\.pem$|\.key$|\.p12$|\.pfx$|id_[rd]sa|credentials|secrets?\.[a-z]+$/i;

const dir = (root) => join(root, '.claude', 'taste-watch');
const indexFile = (root) => join(dir(root), 'index.json');
const sha = (s) => createHash('sha256').update(s).digest('hex');

function loadIndex(root) {
  try {
    return JSON.parse(readFileSync(indexFile(root), 'utf8'));
  } catch {
    return {};
  }
}

function saveIndex(root, index) {
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(indexFile(root), JSON.stringify(index));
}

export function isTrackable(file) {
  if (SENSITIVE.test(file)) return false;
  try {
    return statSync(file).size <= MAX_BYTES;
  } catch {
    return false;
  }
}

/** Snapshot a file right after Claude wrote it. */
export function track(file, root = projectRoot()) {
  if (!isTrackable(file)) return false;
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const index = loadIndex(root);
  const key = sha(file).slice(0, 16);
  index[file] = { hash: sha(content), at: new Date().toISOString(), snap: key };
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(join(dir(root), `${key}.snap`), content);
  prune(root, index);
  saveIndex(root, index);
  return true;
}

function prune(root, index) {
  const entries = Object.entries(index).sort((a, b) => a[1].at.localeCompare(b[1].at));
  for (const [file, rec] of entries.slice(0, Math.max(0, entries.length - MAX_TRACKED))) {
    rmSync(join(dir(root), `${rec.snap}.snap`), { force: true });
    delete index[file];
  }
}

/**
 * Find files that changed since Claude wrote them. Re-snapshots each one it
 * reports, so a given revision is surfaced exactly once.
 */
export function detect(root = projectRoot()) {
  const index = loadIndex(root);
  const found = [];
  let dirty = false;

  for (const [file, rec] of Object.entries(index)) {
    if (!existsSync(file)) {
      rmSync(join(dir(root), `${rec.snap}.snap`), { force: true });
      delete index[file];
      dirty = true;
      continue;
    }
    let current;
    try {
      current = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hash = sha(current);
    if (hash === rec.hash) continue;

    const snapPath = join(dir(root), `${rec.snap}.snap`);
    const before = existsSync(snapPath) ? readFileSync(snapPath, 'utf8') : null;
    if (before !== null && before !== current) {
      const d = describe(before, current);
      found.push({
        kind: 'revision',
        file: basename(file),
        path: file,
        ext: extname(file) || 'none',
        ...d,
        summary: `${basename(file)}:${d.line} the user revised what Claude wrote (${d.lines})`,
      });
    }
    writeFileSync(snapPath, current);
    index[file] = { ...rec, hash, at: new Date().toISOString() };
    dirty = true;
  }

  if (dirty || found.length) saveIndex(root, index);
  return found;
}

export function clear(root = projectRoot()) {
  rmSync(dir(root), { recursive: true, force: true });
}

export function tracked(root = projectRoot()) {
  return Object.keys(loadIndex(root)).length;
}

/** Snapshot files with no index entry are orphans; used by tests and `taste status`. */
export function orphans(root = projectRoot()) {
  if (!existsSync(dir(root))) return 0;
  const live = new Set(Object.values(loadIndex(root)).map((r) => `${r.snap}.snap`));
  return readdirSync(dir(root)).filter((f) => f.endsWith('.snap') && !live.has(f)).length;
}
