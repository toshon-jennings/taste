#!/usr/bin/env node
/**
 * Signal capture. One script, dispatching on hook_event_name, because every
 * event does the same thing: write one line to the local signal log.
 *
 * What counts as a signal:
 *   UserPromptSubmit   what you asked for, in your words — the strongest source
 *                      of stated preference ("stop using barrel files"). Also
 *                      when we check whether you rewrote anything Claude wrote.
 *   PostToolUse        an edit that survived: which file, which extension, and
 *                      a short shape of the change. Also snapshots the result.
 *   PermissionDenied   a tool call you refused — a negative signal
 *   Stop               turn boundary, and the nudge to distill once evidence piles up
 *   SessionStart       catches revisions made between sessions
 *
 * Nothing is sent anywhere. Nothing is inferred here. This file only records;
 * turning records into rules is a separate, reviewable step (/taste-learn).
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { resolveLearning } from '../src/settings.mjs';
import { append, unprocessed } from '../src/signals.mjs';
import { detect, track } from '../src/watch.mjs';

const NUDGE_AT = 25;

const read = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
};

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);

const recordRevisions = (event, root) => {
  for (const revision of detect(root)) {
    append({ session: event.session_id, ...revision }, root);
  }
};

const shape = (input = {}) => {
  const file = input.file_path ?? input.notebook_path;
  if (!file) return null;
  const added = (input.new_string ?? input.content ?? '').split('\n').length;
  const removed = (input.old_string ?? '').split('\n').length;
  return {
    file: basename(file),
    dir: file.replace(/\/[^/]*$/, ''),
    ext: extname(file) || 'none',
    lines: input.old_string ? `+${added}/-${removed}` : `+${added}`,
  };
};

function run() {
  const event = read();
  const root = event.cwd || process.env.CLAUDE_PROJECT_DIR;
  if (!resolveLearning(root).enabled) return;

  switch (event.hook_event_name) {
    case 'SessionStart':
      recordRevisions(event, root);
      return;
    case 'UserPromptSubmit': {
      // Check before recording the prompt: whatever you changed by hand, you
      // changed before sitting down to type this.
      recordRevisions(event, root);
      const prompt = (event.prompt ?? '').trim();
      if (prompt.length < 8) return;
      append({ kind: 'prompt', session: event.session_id, summary: prompt.slice(0, 2000) }, root);
      return;
    }
    case 'PostToolUse': {
      const s = shape(event.tool_input);
      if (!s) return;
      append({ kind: 'edit', session: event.session_id, tool: event.tool_name, ...s, summary: `${s.file} ${s.lines}` }, root);
      // Snapshot what Claude just wrote, so a later hand-edit is visible as one.
      const file = event.tool_input?.file_path ?? event.tool_input?.notebook_path;
      if (file) track(file, root);
      return;
    }
    case 'PermissionDenied': {
      append({
        kind: 'denied',
        session: event.session_id,
        tool: event.tool_name,
        summary: `${event.tool_name}: ${JSON.stringify(event.tool_input ?? {}).slice(0, 300)}`,
      }, root);
      return;
    }
    case 'Stop': {
      append({ kind: 'turn-end', session: event.session_id, summary: '' }, root);
      const pending = unprocessed(root).length;
      if (pending >= NUDGE_AT && pending % NUDGE_AT < 3) {
        emit({
          systemMessage: `taste: ${pending} unprocessed signals. Run /taste-learn to turn them into reviewable preferences.`,
          suppressOutput: true,
        });
      }
      return;
    }
    default:
  }
}

try {
  run();
} catch {
  // A learning system must never be able to break the session it learns from.
}
process.exit(0);
