#!/usr/bin/env node
/**
 * SessionStart: put earned preferences into context, and nothing else.
 * Only rules above the confidence floor are spent on tokens, capped by budget,
 * so the block stays small whether you have 5 learnings or 500.
 */
import { readFileSync } from 'node:fs';
import { contextBlock } from '../src/cli.mjs';

try {
  try {
    JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    /* stdin is optional */
  }
  const additionalContext = contextBlock({ max: 4000 });
  if (additionalContext) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
        suppressOutput: true,
      })}\n`,
    );
  }
} catch {
  // Never block a session over taste.
}
process.exit(0);
