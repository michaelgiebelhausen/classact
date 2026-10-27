/** Allocations use integer hundredths of a percent: the stored total is exact. */
export const ALLOCATION_TOTAL = 10_000;
export type Allocation = Record<string, number>;
export type ContributionMember = { id: string; name: string; profile_id: string | null };
export type Agreement = {
  id: string; team_id: string; course_id: string; roster: ContributionMember[];
  shares: Allocation; confirmations: string[]; confirmed_at: string | null;
  note: string; created_at: string;
};
export type Checkpoint = {
  id: string; team_id: string; course_id: string; title: string; deadline: string;
  roster: ContributionMember[]; agreement_id: string; created_at: string;
};
export type ContributionResponse = {
  checkpoint_id: string; respondent_id: string; respondent_profile_id: string;
  course_id: string; actual: Allocation | null; credit: Allocation | null;
  declined: boolean; explanation: string; help_requested: boolean;
  submitted_at: string | null; revision: number; updated_at: string;
};

export function equalAllocation(ids: string[]): Allocation {
  if (!ids.length) return {};
  const base = Math.floor(ALLOCATION_TOTAL / ids.length);
  return Object.fromEntries(ids.map((id, i) => [id, base + (i < ALLOCATION_TOTAL % ids.length ? 1 : 0)]));
}

export function validAllocation(value: Allocation, ids: string[]): boolean {
  return Object.keys(value).length === ids.length && ids.every(id =>
    Number.isInteger(value[id]) && value[id] >= 0 && value[id] <= ALLOCATION_TOTAL
  ) && Object.values(value).reduce((a, b) => a + b, 0) === ALLOCATION_TOTAL;
}

/** Largest remainder apportionment, stable roster order breaks rounding ties. */
export function rebalance(value: Allocation, id: string, requested: number, locked: string[] = []): Allocation {
  if (!(id in value) || locked.includes(id) || !Number.isFinite(requested)) return value;
  const others = Object.keys(value).filter(key => key !== id && !locked.includes(key));
  const fixed = Object.keys(value).filter(key => key !== id && locked.includes(key)).reduce((s, key) => s + value[key], 0);
  if (!others.length) return value;
  const target = Math.max(0, Math.min(ALLOCATION_TOTAL - fixed, Math.round(requested)));
  const remainder = ALLOCATION_TOTAL - fixed - target;
  const weight = others.reduce((s, key) => s + value[key], 0);
  const raw = others.map((key, order) => ({ key, order, n: weight ? remainder * value[key] / weight : remainder / others.length }));
  const next = { ...value, [id]: target };
  for (const row of raw) next[row.key] = Math.floor(row.n);
  const extra = remainder - raw.reduce((s, row) => s + Math.floor(row.n), 0);
  raw.sort((a, b) => (b.n % 1) - (a.n % 1) || a.order - b.order);
  raw.slice(0, extra).forEach(row => next[row.key]++);
  return next;
}

export function needsExplanation(actual: Allocation, credit: Allocation): boolean {
  return Object.keys(actual).some(id => actual[id] === 0 || Math.abs(actual[id] - credit[id]) > 100);
}

export function summarizeContributions(roster: ContributionMember[], responses: ContributionResponse[]) {
  const valid = responses.filter(r => r.submitted_at && !r.declined && r.actual && r.credit);
  const range = (values: number[]) => values.length ? {
    mean: values.reduce((s, n) => s + n, 0) / values.length,
    min: Math.min(...values), max: Math.max(...values), n: values.length,
  } : null;
  return roster.map(member => ({
    ...member,
    self: valid.find(r => r.respondent_id === member.id)?.actual?.[member.id] ?? null,
    peers: range(valid.filter(r => r.respondent_id !== member.id).map(r => r.actual![member.id])),
    credit: range(valid.map(r => r.credit![member.id])),
  }));
}
