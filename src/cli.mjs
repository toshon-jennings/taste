import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { INJECT_FLOOR, confidence } from './confidence.mjs';
import { packageFile, projectRoot, remoteClone, tasteDir } from './paths.mjs';
import { getConfig, resolveLearning, setConfig, setLearning } from './settings.mjs';
import * as signals from './signals.mjs';
import * as watch from './watch.mjs';
import { merge, packages, parse, read, serialize, slug, upsert, write } from './store.mjs';

const root = projectRoot();
const out = (s = '') => process.stdout.write(`${s}\n`);
const die = (s) => {
  process.stderr.write(`taste: ${s}\n`);
  process.exit(1);
};

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-g') flags.global = true;
    else if (a === '-u') flags.user = true;
    else if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const key = k.replace(/-(\w)/g, (_, c) => c.toUpperCase());
      if (v !== undefined) flags[key] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('-') && VALUE_FLAGS.has(key)) flags[key] = argv[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}
const VALUE_FLAGS = new Set(['note', 'source', 'weight', 'max', 'min', 'tail']);

/**
 * How much one observation counts, by where it came from. A rule you stated
 * outright is stronger evidence than one inferred from a single edit; you
 * silently rewriting what Claude wrote sits in between — it is unambiguous, but
 * the reason has to be guessed.
 */
const SOURCE_WEIGHT = { stated: 3, revision: 2, denied: 2 };

const scopeOf = (flags) => (flags.global ? 'global' : 'project');
const label = (pkg) => (pkg === '.' ? '(root)' : pkg);
const pct = (n) => n.toFixed(2);
const ago = (iso) => {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

// ---------------------------------------------------------------- commands

function cmdStatus() {
  const state = resolveLearning(root);
  const pkgs = packages('project', root);
  const globals = packages('global', root);
  const n = pkgs.reduce((acc, p) => acc + read('project', p, root).entries.length, 0);
  out(`taste  ${state.enabled ? 'learning on' : 'learning off'}`);
  out(`  decided by   ${state.key}${state.file ? ` (${state.file.replace(root, '.')})` : ' (nothing set)'}`);
  out(`  project      ${pkgs.length} package${pkgs.length === 1 ? '' : 's'}, ${n} learning${n === 1 ? '' : 's'}  ${tasteDir('project', root).replace(root, '.')}`);
  out(`  global       ${globals.length} package${globals.length === 1 ? '' : 's'}`);
  const watched = watch.tracked(root);
  out(`  watching     ${watched} file${watched === 1 ? '' : 's'} Claude wrote, for revisions you make`);
  out(`  signals      ${signals.unprocessed(root).length} unprocessed of ${signals.readAll(root).length}`);
  const remote = getConfig(root).remote;
  out(`  remote       ${remote ?? 'not set  (taste remote <git-url>)'}`);
}

function cmdEnable(on, flags) {
  const scope = setLearning(on, flags.user ? 'user' : 'project', root);
  out(`taste learning ${on ? 'enabled' : 'disabled'} for ${scope.affects} → ${scope.file}`);
  if (!flags.user && scope.key === 'project') out('a project setting takes precedence over your user setting.');
}

function cmdList(flags) {
  const scope = scopeOf(flags);
  const dir = tasteDir(scope, root);
  const pkgs = packages(scope, root);
  out(`Taste packages`);
  out(`Stored in ${dir}`);
  out('');
  if (!pkgs.length) return out('  (none yet)');
  let total = 0;
  for (const p of pkgs) {
    const data = read(scope, p, root);
    total += data.entries.length;
    const last = data.entries.map((e) => e.last).filter(Boolean).sort().pop();
    out(`  ${label(p).padEnd(16)} ${String(data.entries.length).padStart(3)} learnings, updated ${ago(last)}`);
  }
  out('');
  out(`Total: ${pkgs.length} packages, ${total} learnings`);
}

function cmdShow(positional, flags) {
  const scope = scopeOf(flags);
  const pkgs = positional.length ? positional : packages(scope, root);
  if (!pkgs.length) return out('no packages yet — try: taste add <package> "<rule>"');
  for (const p of pkgs) {
    const data = read(scope, p, root);
    out(`${label(p)}  (${data.entries.length} learnings)`);
    for (const e of [...data.entries].sort((a, b) => confidence(b) - confidence(a))) {
      out(`  ${pct(confidence(e))}  ${e.rule}`);
      if (e.note) out(`         ${e.note.split('\n')[0]}`);
      out(`         ${e.confirms}✓ / ${e.contradicts}✗  ${e.sources.join(',') || 'manual'}  last ${ago(e.last)}`);
    }
    out('');
  }
}

function cmdAdd(positional, flags) {
  const [pkg, rule] = positional;
  if (!pkg || !rule) die('usage: taste add <package> "<rule>" [--contradict] [--note "..."] [--source <kind>]');
  const scope = scopeOf(flags);
  const data = read(scope, pkg, root);
  const kind = flags.contradict ? 'contradict' : 'confirm';
  const source = flags.source ?? 'manual';
  const { entry, isNew } = upsert(data, rule, kind, {
    note: flags.note,
    source,
    weight: flags.weight ? Number(flags.weight) : (SOURCE_WEIGHT[source] ?? 1),
  });
  const file = write(scope, pkg, data, root);
  out(`${isNew ? 'added' : 'updated'} ${label(pkg)} → ${pct(confidence(entry))}  ${entry.rule}`);
  out(`saved to: ${file}`);
}

function cmdLint(positional, flags) {
  const scope = scopeOf(flags);
  const pkgs = flags.all || !positional.length ? packages(scope, root) : positional;
  let errors = 0;
  let warnings = 0;
  let files = 0;
  for (const p of pkgs) {
    const file = packageFile(scope, p, root);
    if (!existsSync(file)) {
      out(`${label(p)}\n  ✗ no taste.md`);
      errors++;
      continue;
    }
    files++;
    const data = parse(readFileSync(file, 'utf8'));
    const problems = [];
    const seen = new Set();
    for (const e of data.entries) {
      if (e._malformed) problems.push(['error', `"${e.rule}": metadata is not valid JSON`]);
      if (!e.rule) problems.push(['error', 'empty rule heading']);
      if (e.rule.length > 200) problems.push(['warning', `"${e.rule.slice(0, 40)}…": rule is very long, split it`]);
      for (const k of ['confirms', 'contradicts']) {
        if (typeof e[k] !== 'number' || !Number.isFinite(e[k]) || e[k] < 0) {
          problems.push(['error', `"${e.rule}": ${k} must be a number >= 0`]);
        }
      }
      const c = confidence(e);
      if (!(c >= 0 && c <= 1)) problems.push(['error', `"${e.rule}": confidence out of range`]);
      if (seen.has(e.id)) problems.push(['warning', `duplicate id "${e.id}"`]);
      seen.add(e.id);
      if (e.id !== slug(e.rule) && !e.first) problems.push(['warning', `"${e.rule}": id does not match rule and has no history`]);
    }
    const errs = problems.filter(([k]) => k === 'error');
    const warns = problems.filter(([k]) => k === 'warning');
    errors += errs.length;
    warnings += warns.length;
    out(`${label(p)}/taste.md`);
    if (!problems.length) out('  ✓ valid');
    for (const [kind, msg] of problems) out(`  ${kind === 'error' ? '✗' : '!'} ${msg}`);
    if (flags.fix && problems.length) {
      // An entry with no rule text carries no information, so drop it rather
      // than inventing one. Everything else is repairable in place.
      const kept = data.entries.filter((e) => e.rule);
      const dropped = data.entries.length - kept.length;
      writeFileSync(file, serialize({ ...data, package: p, entries: kept.map(normalize) }));
      out(`  → rewrote with normalized metadata${dropped ? `, dropped ${dropped} empty entr${dropped === 1 ? 'y' : 'ies'}` : ''} (--fix)`);
    }
  }
  out('');
  out(`Summary: ${errors} errors, ${warnings} warnings across ${files} file${files === 1 ? '' : 's'}`);
  if (errors) process.exit(1);
}

const normalize = (e) => ({
  ...e,
  id: e.id || slug(e.rule),
  confirms: Number.isFinite(e.confirms) && e.confirms >= 0 ? e.confirms : 0,
  contradicts: Number.isFinite(e.contradicts) && e.contradicts >= 0 ? e.contradicts : 0,
  first: e.first ?? new Date().toISOString(),
  last: e.last ?? new Date().toISOString(),
  sources: Array.isArray(e.sources) ? e.sources : [],
  _malformed: undefined,
});

function cmdOpen(positional, flags) {
  const [pkg] = positional;
  if (!pkg) die('usage: taste open <package>');
  const file = packageFile(scopeOf(flags), pkg, root);
  if (!existsSync(file)) die(`no such package: ${pkg}`);
  const editor = process.env.EDITOR || process.env.VISUAL;
  if (!editor) {
    out('$EDITOR is not set. Add one to your shell profile, e.g.');
    out('  echo \'export EDITOR="code"\' >> ~/.zshrc');
    out(`\nfile: ${file}`);
    return;
  }
  execFileSync(editor, [file], { stdio: 'inherit' });
  out(`✓ opened '${label(pkg)}'`);
}

// ------------------------------------------------------------ share: git

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function ensureRemote() {
  const url = getConfig(root).remote;
  if (!url) die('no remote configured. Set one with: taste remote <git-url>');
  const dir = remoteClone();
  try {
    if (!existsSync(join(dir, '.git'))) {
      mkdirSync(dirname(dir), { recursive: true });
      git(['clone', '--quiet', url, dir]);
    } else {
      git(['pull', '--quiet', '--ff-only'], dir);
    }
  } catch (e) {
    die(`git: ${String(e.stderr || e.message).trim()}`);
  }
  return dir;
}

const remoteFile = (dir, pkg) => (pkg === '.' ? join(dir, 'taste.md') : join(dir, pkg, 'taste.md'));

function readAt(file, pkg) {
  return existsSync(file) ? parse(readFileSync(file, 'utf8')) : { package: pkg, entries: [] };
}

function cmdPush(positional, flags) {
  const pkgs = flags.all ? packages('project', root) : positional;
  if (!pkgs.length) die('usage: taste push <package> | taste push --all   (add -g to push to global)');

  if (flags.global) {
    for (const p of pkgs) {
      const local = read('project', p, root);
      const target = flags.overwrite ? { package: p, entries: [] } : read('global', p, root);
      const { data, added, updated } = merge(target, local);
      write('global', p, data, root);
      out(`✓ pushed '${label(p)}' to global (${added} added, ${updated} updated)`);
    }
    return;
  }

  const dir = ensureRemote();
  for (const p of pkgs) {
    const local = read('project', p, root);
    const file = remoteFile(dir, p);
    const target = flags.overwrite ? { package: p, entries: [] } : readAt(file, p);
    const { data, added, updated } = merge(target, local);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serialize({ ...data, package: p }));
    out(`✓ pushed '${label(p)}' (${added} added, ${updated} updated)`);
  }
  git(['add', '-A'], dir);
  const status = git(['status', '--porcelain'], dir);
  if (!status) return out('remote already up to date, nothing to commit');
  git(['commit', '--quiet', '-m', `taste: push ${pkgs.map(label).join(', ')}`], dir);
  try {
    git(['push', '--quiet'], dir);
    out(`✓ pushed to ${getConfig(root).remote}`);
  } catch (e) {
    die(`git push failed: ${String(e.stderr || e.message).trim()}`);
  }
}

function cmdPull(positional, flags) {
  if (flags.global) {
    const pkgs = flags.all ? packages('global', root) : positional;
    if (!pkgs.length) die('usage: taste pull <package> -g | taste pull --all -g');
    for (const p of pkgs) {
      const incoming = read('global', p, root);
      const target = flags.overwrite ? { package: p, entries: [] } : read('project', p, root);
      const { data, added, updated } = merge(target, incoming);
      const file = write('project', p, data, root);
      out(`✓ pulled '${label(p)}' from global (${added} added, ${updated} updated)`);
      out(`  saved to: ${file.replace(root, '.')}`);
    }
    return;
  }

  const dir = ensureRemote();
  const pkgs = flags.all || !positional.length ? remotePackages(dir) : positional;
  if (!pkgs.length) die('remote has no packages');
  for (const p of pkgs) {
    const incoming = readAt(remoteFile(dir, p), p);
    const target = flags.overwrite ? { package: p, entries: [] } : read('project', p, root);
    const { data, added, updated } = merge(target, incoming);
    const file = write('project', p, data, root);
    out(`✓ pulled '${label(p)}' (${added} added, ${updated} updated)`);
    out(`  saved to: ${file.replace(root, '.')}`);
  }
}

function remotePackages(dir) {
  const names = [];
  if (existsSync(join(dir, 'taste.md'))) names.push('.');
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && !ent.name.startsWith('.') && existsSync(join(dir, ent.name, 'taste.md'))) names.push(ent.name);
  }
  return names;
}

function cmdRemote(positional, flags) {
  const [url] = positional;
  if (!url) return out(getConfig(root).remote ?? 'no remote configured');
  const file = setConfig('remote', url, flags.project ? 'project' : 'user', root);
  out(`remote set to ${url} → ${file}`);
}

// ------------------------------------------------------- signals & context

function cmdSignals(flags) {
  if (flags.clear) {
    signals.clear(root);
    watch.clear(root);
    return out('signal log and file snapshots cleared');
  }
  const all = signals.readAll(root);
  if (flags.consume) {
    const from = signals.cursor(root);
    signals.setCursor(all.length, root);
    return out(`marked ${all.length - from} signals as distilled (cursor ${from} → ${all.length})`);
  }
  const n = flags.tail ? Number(flags.tail) : 20;
  const recent = all.slice(-n);
  // --json gives distillation the full record, including revision diffs; the
  // default view is a one-line-per-signal skim for humans.
  if (flags.json) {
    for (const s of recent) out(JSON.stringify(s));
    return;
  }
  for (const s of recent) {
    out(`${s.at}  ${String(s.kind).padEnd(14)} ${(s.summary ?? '').slice(0, 100)}`);
  }
  out(`\n${all.length} signals, ${signals.unprocessed(root).length} unprocessed (cursor at ${signals.cursor(root)})`);
}

/**
 * The block injected at session start. Only rules that have actually earned
 * confidence get spent on context; everything else stays on disk.
 */
export function contextBlock({ min = INJECT_FLOOR, max = 4000 } = {}) {
  if (!resolveLearning(root).enabled) return '';
  const rows = [];
  for (const scope of ['global', 'project']) {
    for (const p of packages(scope, root)) {
      for (const e of read(scope, p, root).entries) {
        const c = confidence(e);
        if (c >= min) rows.push({ c, pkg: p, rule: e.rule, note: e.note, scope });
      }
    }
  }
  if (!rows.length) return '';
  rows.sort((a, b) => b.c - a.c);
  const lines = ['# Learned taste', '', 'Preferences observed from this user\'s own work. Treat them as defaults, not rules — the current request wins if they conflict.', ''];
  let budget = max;
  let byPkg = '';
  for (const r of rows) {
    const line = `- (${pct(r.c)}) [${label(r.pkg)}] ${r.rule}${r.note ? ` — ${r.note.split('\n')[0]}` : ''}`;
    if (budget - line.length < 0) break;
    budget -= line.length;
    byPkg += `${line}\n`;
  }
  return `${lines.join('\n')}${byPkg}`;
}

function cmdContext(flags) {
  const block = contextBlock({ min: flags.min ? Number(flags.min) : INJECT_FLOOR, max: flags.max ? Number(flags.max) : 4000 });
  if (block) out(block);
}

function cmdInit() {
  mkdirSync(tasteDir('project', root), { recursive: true });
  const gitignore = join(root, '.gitignore');
  const existing = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
  // Both hold raw local evidence — prompts and copies of your files. Only
  // distilled rules are ever meant to leave the machine.
  const missing = ['.claude/taste-signals.*', '.claude/taste-watch/'].filter((e) => !existing.includes(e));
  if (missing.length) {
    const sep = existing && !existing.endsWith('\n') ? '\n' : '';
    writeFileSync(gitignore, `${existing}${sep}${missing.join('\n')}\n`);
    out(`added ${missing.join(' and ')} to .gitignore (raw evidence stays local)`);
  }
  out(`taste store ready at ${tasteDir('project', root).replace(root, '.')}`);
  out('next: keep working. Run /taste-learn when you want signals distilled into rules.');
}

const HELP = `taste — learned coding preferences for Claude Code

  taste status                     is learning on, what is stored, what is pending
  taste init                       create the store, keep the signal log out of git
  taste enable | disable [-u]      toggle learning (project by default, -u for all projects)

  taste list [-g]                  packages and learning counts
  taste show [<package>] [-g]      learnings with confidence
  taste add <pkg> "<rule>"         record a confirmation  [--contradict --note "..." --source <kind>]
                                   weights: stated ×3, revision ×2, denied ×2, anything else ×1
  taste lint [<pkg>|--all] [--fix] validate format and confidence values
  taste open <package> [-g]        open in $EDITOR

  taste push <pkg>|--all [-g]      share: -g to your global store, otherwise the git remote
  taste pull <pkg>|--all [-g]      pull the other way   [--overwrite to skip merging]
  taste remote [<git-url>]         get or set the git remote used for sharing

  taste signals [--tail N]         the raw evidence log  [--json for full records incl. diffs]
                                   [--consume to advance the cursor, --clear to wipe it and the snapshots]
  taste context [--min 0.65]       render the block injected at session start

Stores: .claude/taste/ (project) · ~/.claude/taste/ (global) · a git repo you own (remote)`;

export function main(argv) {
  const { flags, positional } = parseArgs(argv);
  const [cmd, ...rest] = positional;
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      return out(HELP);
    case 'status': return cmdStatus();
    case 'init': return cmdInit();
    case 'enable': return cmdEnable(true, flags);
    case 'disable': return cmdEnable(false, flags);
    case 'list': return cmdList(flags);
    case 'show': return cmdShow(rest, flags);
    case 'add': return cmdAdd(rest, flags);
    case 'lint': return cmdLint(rest, flags);
    case 'open': return cmdOpen(rest, flags);
    case 'push': return cmdPush(rest, flags);
    case 'pull': return cmdPull(rest, flags);
    case 'remote': return cmdRemote(rest, flags);
    case 'signals': return cmdSignals(flags);
    case 'context': return cmdContext(flags);
    default: return die(`unknown command: ${cmd}\n\n${HELP}`);
  }
}
