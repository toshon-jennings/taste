# taste

Learned coding preferences for Claude Code. Captured from real signals, stored as
markdown you can read and delete, shared over git.

```bash
taste status                      # is learning on, what's stored, what's pending
taste show                        # what it thinks you prefer, and how sure it is
taste push --all                  # share with your team, over your own git repo
```

## Why this exists

[Command Code](https://commandcode.ai/docs/taste) ships a feature called Taste,
"powered by our meta neuro-symbolic AI model `taste-1` with continuous
reinforcement learning." Claude Code has no equivalent product — but it has every
part needed to build one, and the honest version turns out to be small.

This is that version. Same shape (learn from your work, store as packages, push
and pull), no claim of a per-user model that does not exist.

## What Claude Code already gives you

| Capability | Claude Code | Gap this fills |
| --- | --- | --- |
| Persistent instructions | `CLAUDE.md`, `.claude/rules/*.md` | You write them by hand |
| Reusable procedures | Skills, subagents | Not derived from your behavior |
| Event capture | Hooks on 30+ lifecycle events | Nothing consumes them for preferences |
| Sharing | Plugins + marketplaces (git repos) | Not per-preference, not merged |
| Layered config | enterprise → local → project → user | — |

The gap is the loop: nothing watches what you actually do and turns it into
instructions with a confidence attached. That loop is what this adds.

## How it works

```
hooks ──► .claude/taste-signals.jsonl ──► /taste-learn ──► .claude/taste/**/taste.md ──► SessionStart
capture        raw evidence, local           you review          rules + confidence         inject
```

**Capture** (`hooks/capture.mjs`) writes one JSONL line per event: prompts you
submit, edits that land, tool calls you deny, turn boundaries. Local only, never
pushed, silent when learning is off.

It also watches for the loudest signal there is — **you rewriting what Claude
wrote**. Each file Claude touches gets snapshotted; at your next prompt the
snapshot is compared against disk, and any hand edit is recorded with its diff:

```json
{ "kind": "revision", "file": "parser.ts", "line": 2,
  "removed": ["  // Parse the input string into tokens", "  if (input) {"],
  "added":   ["  if (!input) return [];"] }
```

That single record contains two preferences — no comments restating the code,
guard clauses over nesting. Detection is lazy (a hash comparison at prompt time),
so there is no watcher, no daemon, and no background process. Claude's own later
edits re-snapshot the file, so they never masquerade as your corrections.

**Distill** (`/taste-learn`) is Claude reading that log and proposing rules. This
is the deliberate part. A preferences file you never agreed to is worse than no
preferences file, so distillation is a step you take, not something that happens
behind you.

**Inject** (`hooks/inject.mjs`) puts only rules above the confidence floor into
context at session start, capped at a character budget. Everything else stays on
disk until it earns its place.

**Share** is git. `taste push -g` moves a package to your global store;
`taste push --all` commits and pushes to a repo you own. Merges are by rule id.

### The file format

Human-first markdown. The bookkeeping rides in an HTML comment, invisible when
rendered, so the file stays something you can read, edit, and argue with.

```markdown
## Put tests next to the source file, not in a top-level tests/ dir
<!-- taste {"id":"put-tests-next-to-the-source-file","confirms":4,"contradicts":0,
     "first":"2026-06-02T…","last":"2026-07-27T…","sources":["edit","stated"]} -->

Observed across 6 files during the parser work.
```

### The scoring rule

Confidence is a Beta-Bernoulli posterior mean over "did this preference hold up?",
with each past observation discounted by a 90-day half-life:

```
c(t) = (α₀ + C̃(t)) / (α₀ + β₀ + C̃(t) + D̃(t))

C̃(t) = Σᵢ λ^((t − tᵢ)/H)   over confirmations
D̃(t) = Σⱼ λ^((t − tⱼ)/H)   over contradictions

α₀ = 1, β₀ = 2, λ = ½, H = 90 days
```

Observations are weighted by where they came from: something you **said** counts
×3, a **revision** or a **denial** ×2, an inferred edit ×1. Someone telling you a
rule is stronger evidence than you guessing one from a diff.

The prior starts an unseen rule at 0.33, so one sighting is not evidence.
Confirmations and contradictions are stored as the decayed running totals rather
than a full event list, which is algebraically identical and much cheaper —
there is a test asserting exactly that.

The injection floor is **0.65**, deliberately between two confirmations (0.600)
and three (0.667): a pattern seen twice is a coincidence. Something you *said*
(`--source stated`) counts triple and clears the floor on its own.

That is the entire model. It is 40 lines in [`src/confidence.mjs`](src/confidence.mjs),
and you should read it before trusting a number it prints.

## About that other equation

Command Code's docs render this as an image on the Taste page:

> Meta-NeuroSymbolic Objective(φ) = 𝔼ₓ~D_RL 𝔼_y~LLM^NS_φ(x) [ RM_NS(x,y) − β_NS log( LLM^NS_φ(y|x) / LLM^SFT(y|x) ) ] + γ_NS 𝔼ₓ~D_pretrain log LLM^NS_φ(x)

Term by term: sample a prompt `x`, sample a response `y` from the current policy,
score it with a reward model, subtract a KL penalty that keeps the policy from
drifting away from the supervised-fine-tuned reference (β sets the leash), and add
a pretraining log-likelihood term so alignment training does not degrade general
capability (γ sets the mix).

This is the **PPO-ptx objective from InstructGPT** (Ouyang et al., 2022, eq. 2),
with `π` renamed to `LLM`, `r_θ` renamed to `RM`, and the subscript `NS` appended
to every term. Nothing in it is neuro-symbolic: there is no symbolic term, no
logic or program component, no constraints. Nothing in it is meta-learned: no
inner and outer loop, no task distribution, one set of parameters `φ` under one
expectation. It is standard RLHF, correctly transcribed, relabelled.

It is also not something that can run on your laptop from your accept/reject
signals — it describes gradient updates to a foundation model during training, not
per-user adaptation at the keyboard. Whatever such a feature does in practice is
almost certainly what this repo does explicitly: write preferences down and put
them in the prompt.

So the equation above is the one this project actually implements. It is much
smaller, and it runs.

## Install

As a Claude Code plugin — this repo is its own marketplace, so it is two steps.
`plugin install` takes a plugin name, never a path:

```bash
claude plugin marketplace add toshon-jennings/taste
claude plugin install taste@taste
```

That gets you both skills, the five hooks, and `taste` on your `PATH` inside
Claude Code, for about 126 tokens of always-on context.

From a local clone, point the marketplace at the directory instead:

```bash
claude plugin marketplace add ./taste
claude plugin install taste@taste
```

Then, in any project:

```bash
taste init
```

Or skip the plugin and use the CLI alone — you lose the hooks, so nothing is
captured automatically, but `add`, `show`, `push`, and `pull` all work:

```bash
npm link && taste status
```

### Working on this repo

Installing copies the plugin into `~/.claude/plugins/cache/` pinned to the
`version` in `plugin.json`, so edits to your working copy do nothing until you
bump it and refresh:

```bash
claude plugin marketplace update taste && claude plugin update taste@taste
```

Drop `version` from `plugin.json` if you would rather track the commit SHA and
get a new version on every commit.

## Commands

| Command | Does |
| --- | --- |
| `taste status` | learning state, counts, pending signals, remote |
| `taste enable \| disable [-u]` | toggle learning; `-u` for all projects |
| `taste list [-g]` | packages and learning counts |
| `taste show [<pkg>] [-g]` | learnings with confidence and evidence |
| `taste add <pkg> "<rule>"` | record a confirmation (`--contradict`, `--note`, `--source`) |
| `taste lint [<pkg>\|--all] [--fix]` | validate format and confidence values |
| `taste open <pkg> [-g]` | open in `$EDITOR` |
| `taste push <pkg>\|--all [-g]` | share to global (`-g`) or the git remote |
| `taste pull <pkg>\|--all [-g]` | pull the other way (`--overwrite` to skip merging) |
| `taste remote [<git-url>]` | get or set the sharing remote |
| `taste signals [--tail N\|--json\|--consume\|--clear]` | inspect the raw evidence log |
| `taste context [--min 0.65]` | render exactly what gets injected |

## Settings

Precedence, highest first. `taste status` reports which file decided.

| Priority | File | Affects | Committed |
| --- | --- | --- | --- |
| 1 | `.claude/taste.local.json` | local setup only | no |
| 2 | `.claude/taste.json` | this project | yes |
| 3 | `~/.claude/taste.json` | all your projects | — |
| 4 | unset | — | on by default |

These are separate files rather than keys inside Claude Code's own
`settings.json`, so toggling taste can never invalidate the host's config.

## Privacy

Two things are written locally and never shared:

- `.claude/taste-signals.jsonl` — the signal log, which contains your prompts
- `.claude/taste-watch/` — snapshots of files Claude wrote, used to diff your
  hand edits. Capped at 50 files and 256 KB each. Files that look sensitive
  (`.env`, `*.pem`, `*.key`, `id_rsa`, `credentials`, `secrets.*`) are never
  snapshotted, and there is a test asserting that.

`taste init` adds both to `.gitignore`. Only distilled rules are ever pushed.
`taste signals --clear` wipes the log and the snapshots. `taste disable` stops
capture entirely: preferences stated during a session stay in that session.

Nothing in this repo makes a network call except `taste push` / `taste pull`,
which run `git` against a remote you configured.

## Development

```bash
node test/run.mjs
```

25 tests, no dependencies, covering the scoring rule (monotonicity, decay, the
equivalence of running totals and event replay, the floor boundaries), the store
(round-trip, dedupe, merge idempotence), and revision detection (exact diffs,
report-once, no false positive from Claude's own edits, secrets never
snapshotted, bounded tracking with no orphaned files).

## License

MIT
