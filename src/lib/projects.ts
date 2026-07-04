/**
 * Shared Projects-feature constants used on both server and client.
 *
 * The default team contract seeds `projects.contract_text` when a professor
 * creates a project (editable there), and each team's own copy is seeded from
 * the project when the team forms.
 */

/**
 * Identifies the auto-created per-member contract card on a team board.
 * Contract cards can't be reassigned, re-estimated, or deleted — they
 * complete by signing the contract.
 */
export const CONTRACT_TASK_TITLE = "Review & sign the team contract";

export const DEFAULT_TEAM_CONTRACT = `TEAM CONTRACT

As a member of this team, I agree to:

1. SHOW UP — attend team meetings, respond to messages within 24 hours, and tell the team early when I can't.

2. DO MY SHARE — complete the tasks I take on by the dates we set, and keep my task board honest (including the actual time things took).

3. SPEAK UP — raise problems with the work (or with how we're working) inside the team first, early, and respectfully.

4. BACK MY TEAMMATES — review others' work when asked, and never mark something done that isn't.

5. OWN THE RESULT — the final deliverable is all of ours; I won't submit or sign off on work I haven't read.

If a teammate isn't holding up their end, we will: (1) talk to them directly, (2) raise it at a team meeting, and only then (3) bring it to the professor with our task board as the record.`;

/** "90 min" / "2h 15m" — one compact format everywhere minutes show up. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
