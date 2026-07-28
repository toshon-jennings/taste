/**
 * The scoring rule. This is the whole "model" — it is meant to be small enough
 * that you can read it and decide whether you believe the numbers.
 *
 *   c(t) = (a0 + C̃(t)) / (a0 + b0 + C̃(t) + D̃(t))
 *
 *   C̃(t) = Σ_i λ^((t - t_i)/H)   over confirmations
 *   D̃(t) = Σ_j λ^((t - t_j)/H)   over contradictions
 *
 * A Beta-Bernoulli posterior mean over "did this preference hold up?", where
 * each past observation is discounted by an exponential half-life H. A rule
 * confirmed twenty times last year outranks nothing; a rule contradicted last
 * week drops fast. Confirmations and contradictions are stored as the decayed
 * running totals C̃, D̃ plus the timestamp they were last decayed to, which is
 * algebraically identical to replaying the full event list and much cheaper.
 *
 * Prior (a0=1, b0=2) starts a brand-new observation at 0.33 rather than 1.0:
 * seeing something once is not evidence of a preference.
 */
export const PRIOR_CONFIRM = 1;
export const PRIOR_CONTRADICT = 2;
export const HALF_LIFE_DAYS = 90;

/**
 * Confidence a rule must reach before it is worth spending context on.
 * Sits deliberately between two and three unweighted confirmations
 * (0.600 and 0.667): a pattern seen twice is a coincidence.
 */
export const INJECT_FLOOR = 0.65;

const DAY_MS = 86_400_000;
const LAMBDA = 0.5;

/** Discount factor for evidence that is `ms` milliseconds old. */
export function decay(ms) {
  if (!(ms > 0)) return 1;
  return LAMBDA ** (ms / DAY_MS / HALF_LIFE_DAYS);
}

export function confidence({ confirms = 0, contradicts = 0, last } = {}, now = Date.now()) {
  const d = decay(now - Date.parse(last ?? new Date(now).toISOString()));
  const c = confirms * d;
  const k = contradicts * d;
  return (PRIOR_CONFIRM + c) / (PRIOR_CONFIRM + PRIOR_CONTRADICT + c + k);
}

/**
 * Fold one new observation into an entry's decayed counts.
 * kind is 'confirm' | 'contradict'; weight lets a strong signal (an explicit
 * instruction) count for more than a weak one (an inferred edit pattern).
 */
export function observe(entry, kind, { weight = 1, now = Date.now() } = {}) {
  const iso = new Date(now).toISOString();
  const d = decay(now - Date.parse(entry.last ?? iso));
  const confirms = round((entry.confirms ?? 0) * d + (kind === 'confirm' ? weight : 0));
  const contradicts = round((entry.contradicts ?? 0) * d + (kind === 'contradict' ? weight : 0));
  return { ...entry, confirms, contradicts, first: entry.first ?? iso, last: iso };
}

const round = (n) => Math.round(n * 1000) / 1000;
