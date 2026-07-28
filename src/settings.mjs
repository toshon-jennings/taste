import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { globalRoot, projectRoot } from './paths.mjs';

/**
 * Own config files rather than Claude Code's settings.json, so toggling taste
 * can never invalidate the host's own schema. Precedence, highest first.
 */
export function scopes(root = projectRoot()) {
  return [
    { key: 'local', file: join(root, '.claude', 'taste.local.json'), affects: 'local setup only', shared: 'no, not committed' },
    { key: 'project', file: join(root, '.claude', 'taste.json'), affects: 'this project', shared: 'yes, committed' },
    { key: 'user', file: join(globalRoot(), 'taste.json'), affects: 'all your projects', shared: '-' },
  ];
}

const load = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};

/** Where learning is decided, and by which file. */
export function resolveLearning(root = projectRoot()) {
  for (const scope of scopes(root)) {
    if (!existsSync(scope.file)) continue;
    const value = load(scope.file).learning;
    if (typeof value === 'boolean') return { enabled: value, ...scope };
  }
  return { enabled: true, key: 'default', file: null, affects: '-', shared: '-' };
}

export function setLearning(enabled, target = 'project', root = projectRoot()) {
  const scope = scopes(root).find((s) => s.key === target);
  if (!scope) throw new Error(`unknown scope: ${target}`);
  const current = existsSync(scope.file) ? load(scope.file) : {};
  mkdirSync(dirname(scope.file), { recursive: true });
  writeFileSync(scope.file, `${JSON.stringify({ ...current, learning: enabled }, null, 2)}\n`);
  return scope;
}

export function getConfig(root = projectRoot()) {
  return { ...load(join(globalRoot(), 'taste.json')), ...load(join(root, '.claude', 'taste.json')) };
}

export function setConfig(key, value, target = 'user', root = projectRoot()) {
  const scope = scopes(root).find((s) => s.key === target);
  const current = existsSync(scope.file) ? load(scope.file) : {};
  mkdirSync(dirname(scope.file), { recursive: true });
  writeFileSync(scope.file, `${JSON.stringify({ ...current, [key]: value }, null, 2)}\n`);
  return scope.file;
}
