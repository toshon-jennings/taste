/**
 * Just enough diff to see what a human changed.
 *
 * Strip the common prefix and the common suffix; whatever is left is the region
 * that changed. For a single localized edit — which is what a person correcting
 * one thing produces — this is exact and O(n). For several scattered edits it
 * returns one region spanning them, which is wider than ideal but still points
 * at the right code. That is the whole trade: no LCS, no quadratic blowup, no
 * dependency, and the answer is right in the case that matters.
 */

const MAX_LINES = 20;
const MAX_LINE_CHARS = 200;

export function changedRegion(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;

  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }

  return {
    line: start + 1,
    removed: before.slice(start, endBefore),
    added: after.slice(start, endAfter),
  };
}

const clip = (lines) =>
  lines.slice(0, MAX_LINES).map((l) => (l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}…` : l));

/** A signal-sized description of what changed between two file versions. */
export function describe(beforeText, afterText) {
  const before = beforeText.split('\n');
  const after = afterText.split('\n');
  const { line, removed, added } = changedRegion(before, after);
  return {
    line,
    removed: clip(removed),
    added: clip(added),
    truncated: removed.length > MAX_LINES || added.length > MAX_LINES,
    lines: `+${added.length}/-${removed.length}`,
  };
}
