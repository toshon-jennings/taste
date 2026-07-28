---
name: taste-learn
description: Distill the raw taste signal log into reviewable preference rules. Use when the user runs /taste-learn, asks you to learn from recent work, or when a taste nudge reports unprocessed signals.
---

# Distill signals into taste

The capture hooks record what happened. This step turns that record into rules —
and it is deliberately a step you take, not something that happens invisibly,
because a preference file you did not agree to is worse than no preference file.

## 1. Read the evidence

```bash
taste signals --tail 200
```

Everything before the cursor has already been distilled. Focus on what is after it
(`taste status` reports the count).

## 2. Find the patterns worth keeping

You are looking for **standing preferences**, not history. A rule earns its place
only if it would change how you write code next week.

Keep:
- Stated instructions that generalize — "always use X", "never Y", "we do Z here"
- Corrections repeated across different tasks — the same fix asked for twice
- Structural regularities in edits — where tests go, how files are named, which
  layer imports which
- Refusals with a reason — a denied command that reveals a boundary

Discard:
- Anything true of one task only ("rename this function")
- Restatements of what the code already enforces — a linter rule, a type, a
  CI check. If a tool already catches it, a preference file is noise.
- Anything already in `CLAUDE.md`. Read it first; do not duplicate it.
- Inferences from a single weak signal. One edit is not a pattern.

Prefer few, sharp rules. Ten rules someone would defend beat sixty they would skim.

## 3. Write them

One command per rule, so each observation lands with its own evidence:

```bash
taste add testing "Put tests next to the source file, not in a top-level tests/ dir" \
  --source edit --note "Observed across 6 files in src/ during the parser work"
```

- `--source stated` for the user's own words, `edit` for observed structure,
  `denied` for a refusal. Sources show up in `taste show`. `stated` counts triple,
  because someone telling you a rule is stronger evidence than you inferring one.
- Re-run the same `taste add` when you see a pattern hold again — repeated
  confirmations are exactly what raises confidence.
- `--contradict` when the log shows a recorded rule being overruled.
- Phrase the rule as an instruction, in the second person implied: "Prefer X",
  "Put Y in Z", "Never A". It goes into a prompt; write it like one.

## 4. Advance the cursor and report

After writing, mark the signals you read as distilled so the next round starts
where this one stopped:

```bash
taste signals --consume && taste status
```

Then tell the user, briefly: what you added, what you skipped and why, and which
rules are close to the 0.65 injection floor. Offer `taste show <package>` for
detail rather than printing everything.

## Rules about rules

- Never record credentials, tokens, paths outside the project, or anything from
  a file the user flagged as private. The signal log is local; taste packages get
  pushed.
- Never `taste push` to a remote as part of distillation. Sharing is a separate,
  explicit decision.
- If distillation produces nothing worth keeping, say so and advance the cursor.
  An empty round is a real result.
