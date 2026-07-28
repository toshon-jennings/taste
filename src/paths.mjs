import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Project root: $CLAUDE_PROJECT_DIR when Claude Code sets it, otherwise the
 * nearest ancestor containing .claude/ or .git/, otherwise cwd.
 */
export function projectRoot(start = process.cwd()) {
  if (process.env.CLAUDE_PROJECT_DIR) return resolve(process.env.CLAUDE_PROJECT_DIR);
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.claude')) || existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export const globalRoot = () => join(homedir(), '.claude');

/** Root of a taste store. scope is 'project' | 'global'. */
export function tasteDir(scope, root = projectRoot()) {
  return join(scope === 'global' ? globalRoot() : join(root, '.claude'), 'taste');
}

export const packageFile = (scope, pkg, root) =>
  pkg === '.' ? join(tasteDir(scope, root), 'taste.md') : join(tasteDir(scope, root), pkg, 'taste.md');

/** Local-only, never shared: the raw signal log and its distillation cursor. */
export const signalLog = (root = projectRoot()) => join(root, '.claude', 'taste-signals.jsonl');
export const signalCursor = (root = projectRoot()) => join(root, '.claude', 'taste-signals.cursor');

/** Working clone used by push/pull against a git remote. */
export const remoteClone = () => join(globalRoot(), 'taste-remote');
