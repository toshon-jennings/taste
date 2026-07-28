---
name: taste
description: Show and manage learned coding preferences — what taste has learned, how confident it is, and whether learning is on. Use when the user runs /taste, asks what preferences you've learned about them, asks to turn taste learning on or off, or wants to add, edit, or share a preference.
---

# Taste

Learned preferences live in `.claude/taste/<package>/taste.md` (this project) and
`~/.claude/taste/` (all projects). The `taste` CLI is the only thing that should
write them — it maintains the confidence bookkeeping that hand-editing breaks.

## Show the panel

Run these and present the result as a short report, not a wall of output:

```bash
taste status && taste list
```

Then, if there are learnings, `taste show` for the packages that matter to the
current conversation. Lead with what has high confidence; mention the low-confidence
tail only as a count.

## Turn learning on or off

```bash
taste disable          # this project (takes precedence over the user setting)
taste enable
taste disable -u       # all projects
```

Precedence, highest first: `.claude/taste.local.json` → `.claude/taste.json` →
`~/.claude/taste.json` → on by default. `taste status` reports which one decided.

When learning is off, the capture hooks write nothing: preferences stated in the
session stay in the session.

## Record a preference the user just stated

When the user states a durable preference ("always X", "stop doing Y", "we use Z
here"), record it — but only when it reads as a standing rule, not a one-off
instruction for the current task.

```bash
taste add typescript "Prefer type aliases over interfaces for object shapes" --source stated --note "Stated 2026-07-28 while refactoring api/"
```

Use `--contradict` when the user overturns something already recorded; that lowers
its confidence instead of deleting it, which is usually what they mean.

Package names are free-form and should describe a domain, not a project:
`typescript`, `react`, `testing`, `cli`, `architecture`, `git`.

## Share

```bash
taste push cli -g                 # project → your global store
taste pull cli -g                 # global → this project
taste remote git@github.com:you/taste.git
taste push --all                  # → the git remote
taste pull --all
```

Push and pull merge by default: a rule known on both sides keeps the higher
evidence counts rather than summing them. `--overwrite` replaces instead.

Never run `taste push` to a remote without the user asking — it publishes.

## Confidence

Each rule carries decayed confirmation and contradiction counts; confidence is
`(1 + C̃) / (3 + C̃ + D̃)` with a 90-day half-life on the evidence. Nothing below
**0.65** is injected into context — that sits between two and three plain
confirmations, so a pattern seen twice stays on disk. `--source stated` counts
triple, so something the user said outright clears the floor immediately.

See `src/confidence.mjs`. It is 40 lines, and worth reading before trusting a
number it produces.
