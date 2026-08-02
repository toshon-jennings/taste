---
name: taste-learn
description: Distill the raw taste signal log into reviewable preference rules. Use when the user runs /taste-learn, asks you to learn from recent work, or when a taste nudge reports unprocessed signals.
---

# Distill signals into taste

The capture hooks record what happened. This step turns that record into rules —
and it is deliberately something the user asks for, not something that happens
invisibly, because a preference file they never agreed to is worse than none.

## 1. Read the evidence

```bash
taste signals --tail 200          # skim
taste signals --tail 200 --json   # full records, including revision diffs
```

Everything before the cursor has already been distilled. Focus on what is after it
(`taste status` reports the count).

Signal kinds, weakest to strongest:

| kind | what it is | how much to trust it |
| --- | --- | --- |
| `edit` | a file Claude wrote | weak — shows structure, not preference |
| `turn-end` | a turn boundary | context only |
| `denied` | a tool call the user refused | strong, but you must infer the reason |
| `revision` | **the user rewrote what Claude wrote** | strongest available |
| `prompt` | the user's own words | strongest when it states a standing rule |

## 1a. Revisions deserve most of your attention

A `revision` is Claude getting something wrong and the user silently fixing it.
Use `--json` to see `removed` and `added` — the actual lines. Read them as a pair
and ask what the change *means*:

```json
{ "kind": "revision", "file": "parser.ts", "line": 2,
  "removed": ["  // Parse the input string into tokens", "  if (input) {", "    return input.split(\" \");", "  }"],
  "added":   ["  if (!input) return [];", "  return input.split(\" \");"] }
```

Two separate preferences are visible there: comments that restate the code get
deleted, and guard clauses are preferred to wrapping the body in a conditional.
Record them as two rules, not one, with `--source revision`.

Be careful what you attribute to taste:

- **Formatters are not preferences.** If the diff is only whitespace, quote style,
  trailing commas, or import order, a tool did it on save. Skip it — unless the
  same reformatting keeps appearing, in which case the rule is about the tool
  ("this project formats on save with X"), not about style.
- **One revision is one data point.** Record it; do not inflate it. Confidence
  is designed to make a single correction sit below the injection floor.
- **Do not guess intent from a deletion alone.** If the user removed code and you
  cannot say why, that is not a preference, it is a change.

## 2. Find the patterns worth keeping

You are looking for **standing preferences**, not history. A rule earns its place
only if it would change how you write code next week.

Keep:
- Stated instructions that generalize — "always use X", "never Y", "we do Z here"
- Hand revisions that carry an inferable reason (see above)
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

- Sources carry weight: `stated` ×3, `revision` ×2, `denied` ×2, `edit` ×1.
  They show up in `taste show`, so the provenance of a rule stays visible.
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
