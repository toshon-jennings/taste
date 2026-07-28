import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { confidence, observe } from './confidence.mjs';
import { packageFile, tasteDir } from './paths.mjs';

/**
 * A taste.md is human-first markdown. Each learning is an `## ` heading (the
 * rule, stated as an instruction) followed by an HTML comment carrying its
 * bookkeeping, then optional prose. The comment is invisible when rendered and
 * trivial to parse; the file stays readable and hand-editable, which is the
 * point — you should be able to disagree with a line and delete it.
 */

export const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'entry';

export function parse(text) {
  const out = { package: null, updated: null, entries: [] };
  let body = text;

  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
    body = text.slice(fm[0].length);
  }

  const blocks = body.split(/^## /m).slice(1);
  for (const block of blocks) {
    const nl = block.indexOf('\n');
    const rule = (nl === -1 ? block : block.slice(0, nl)).trim();
    let rest = nl === -1 ? '' : block.slice(nl + 1);
    let meta = {};
    const mm = /<!--\s*taste\s*(\{[\s\S]*?\})\s*-->\n?/.exec(rest);
    if (mm) {
      try {
        meta = JSON.parse(mm[1]);
      } catch {
        meta = { _malformed: mm[1] };
      }
      rest = rest.slice(0, mm.index) + rest.slice(mm.index + mm[0].length);
    }
    out.entries.push({
      id: meta.id ?? slug(rule),
      rule,
      confirms: meta.confirms ?? 0,
      contradicts: meta.contradicts ?? 0,
      first: meta.first ?? null,
      last: meta.last ?? null,
      sources: meta.sources ?? [],
      note: rest.trim(),
      _malformed: meta._malformed,
    });
  }
  return out;
}

export function serialize(pkg) {
  const lines = ['---', `package: ${pkg.package ?? '.'}`, `updated: ${new Date().toISOString()}`, '---', ''];
  lines.push(`# ${pkg.package ?? 'taste'}`, '');
  const sorted = [...pkg.entries].sort((a, b) => confidence(b) - confidence(a));
  for (const e of sorted) {
    const meta = {
      id: e.id,
      confirms: e.confirms,
      contradicts: e.contradicts,
      first: e.first,
      last: e.last,
      sources: e.sources,
    };
    lines.push(`## ${e.rule}`, `<!-- taste ${JSON.stringify(meta)} -->`, '');
    if (e.note) lines.push(e.note, '');
  }
  return lines.join('\n');
}

export function read(scope, pkg, root) {
  const file = packageFile(scope, pkg, root);
  if (!existsSync(file)) return { package: pkg, updated: null, entries: [] };
  const parsed = parse(readFileSync(file, 'utf8'));
  parsed.package = parsed.package ?? pkg;
  return parsed;
}

export function write(scope, pkg, data, root) {
  const file = packageFile(scope, pkg, root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialize({ ...data, package: pkg }));
  return file;
}

/** Record an observation about a rule, creating the entry if it is new. */
export function upsert(data, rule, kind = 'confirm', { note, source, weight, now } = {}) {
  const id = slug(rule);
  let entry = data.entries.find((e) => e.id === id || e.rule.toLowerCase() === rule.toLowerCase());
  const isNew = !entry;
  if (isNew) {
    entry = { id, rule, confirms: 0, contradicts: 0, first: null, last: null, sources: [], note: '' };
    data.entries.push(entry);
  }
  Object.assign(entry, observe(entry, kind, { weight, now }));
  if (note) entry.note = note;
  if (source && !entry.sources.includes(source)) entry.sources.push(source);
  return { entry, isNew };
}

/**
 * Union by id. When both sides know a rule, keep the larger evidence counts
 * rather than adding them: the two copies usually descend from the same
 * observations, and summing would inflate confidence on every round trip.
 */
export function merge(local, incoming) {
  const byId = new Map(local.entries.map((e) => [e.id, { ...e }]));
  for (const inc of incoming.entries) {
    const cur = byId.get(inc.id);
    if (!cur) {
      byId.set(inc.id, { ...inc });
      continue;
    }
    const newer = Date.parse(inc.last ?? 0) > Date.parse(cur.last ?? 0) ? inc : cur;
    byId.set(inc.id, {
      ...cur,
      rule: newer.rule,
      note: newer.note || cur.note,
      confirms: Math.max(cur.confirms, inc.confirms),
      contradicts: Math.max(cur.contradicts, inc.contradicts),
      first: [cur.first, inc.first].filter(Boolean).sort()[0] ?? null,
      last: [cur.last, inc.last].filter(Boolean).sort().pop() ?? null,
      sources: [...new Set([...cur.sources, ...inc.sources])],
    });
  }
  const added = incoming.entries.filter((e) => !local.entries.some((l) => l.id === e.id)).length;
  const updated = incoming.entries.length - added;
  return { data: { ...local, entries: [...byId.values()] }, added, updated };
}

/** Package names in a store: subdirectories with a taste.md, plus '.' for the root file. */
export function packages(scope, root) {
  const dir = tasteDir(scope, root);
  if (!existsSync(dir)) return [];
  const names = [];
  if (existsSync(join(dir, 'taste.md'))) names.push('.');
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && !ent.name.startsWith('.') && existsSync(join(dir, ent.name, 'taste.md'))) {
      names.push(ent.name);
    }
  }
  return names;
}
