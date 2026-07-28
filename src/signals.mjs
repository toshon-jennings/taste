import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { projectRoot, signalCursor, signalLog } from './paths.mjs';

/**
 * The raw evidence: an append-only JSONL log of what actually happened, kept
 * local to the project and never pushed. Distillation reads from the cursor
 * forward, so nothing is processed twice.
 */
export function append(signal, root = projectRoot()) {
  const file = signalLog(root);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...signal })}\n`);
}

export function readAll(root = projectRoot()) {
  const file = signalLog(root);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export const cursor = (root = projectRoot()) => {
  const file = signalCursor(root);
  return existsSync(file) ? Number(readFileSync(file, 'utf8').trim()) || 0 : 0;
};

export function setCursor(n, root = projectRoot()) {
  const file = signalCursor(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${n}\n`);
}

export const unprocessed = (root = projectRoot()) => readAll(root).slice(cursor(root));

export function clear(root = projectRoot()) {
  const file = signalLog(root);
  if (existsSync(file)) writeFileSync(file, '');
  setCursor(0, root);
}
