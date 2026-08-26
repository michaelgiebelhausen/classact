/**
 * Matching a student's own account to their official Canvas roster row.
 *
 * Students join with whatever address they like — a personal Gmail, an iCloud
 * account, the g.-twin of their university address — while Canvas only ever
 * reports the official one. Canvas is the roster of record, so the two have to
 * be reconciled, and outside the g.-twin case (handled automatically) that
 * takes a human.
 *
 * **The merge keeps the student's row and gives it the Canvas identity**, then
 * removes the empty Canvas row. It never moves history the other way. Twenty-
 * two tables cascade-delete off `enrollments`, so a merge that relocated
 * attendance would have to repoint twenty-five foreign keys correctly every
 * time; adopting the identity instead is two fields and a delete. It is also
 * exactly what the Canvas sync already does for g.-twins.
 */

export interface AdoptFacts {
  /** The Canvas row is owned by some account. */
  canvasHasProfile: boolean;
  /** The Canvas row carries check-ins or other history of its own. */
  canvasHasHistory: boolean;
}

export type AdoptVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

export function canAdoptCanvasIdentity(facts: AdoptFacts): AdoptVerdict {
  if (facts.canvasHasProfile) {
    return {
      allowed: false,
      reason:
        "That Canvas row already belongs to an account. Two real logins can't be merged automatically — sort out which one the student uses first.",
    };
  }
  if (facts.canvasHasHistory) {
    return {
      allowed: false,
      reason:
        "That Canvas row has check-ins of its own. Merging would delete them, so this one needs doing by hand.",
    };
  }
  return { allowed: true };
}

export interface CandidateRow {
  id: string;
  name: string;
  email: string;
}

export interface RankedCandidate extends CandidateRow {
  score: number;
  /** Strong enough that a professor can accept it at a glance. */
  confident: boolean;
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const localPart = (email: string) => email.toLowerCase().split("@")[0];
/** Strip the digits students append to personal addresses: tpallotta17 → tpallotta. */
const stem = (local: string) => local.replace(/[^a-z]/g, "");

function overlaps(a: string, b: string, min: number): boolean {
  if (a.length < min || b.length < min) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Rank Canvas rows as possible matches for one student, best first.
 *
 * Everything is returned, not just the plausible ones: the professor knows
 * their own class, and a ranking that hid the right answer would be worse than
 * one that merely mis-ordered it.
 *
 * `confident` is deliberately conservative. A shared first name is not
 * evidence — "Tyler Pallotta" and "Tyler Nguyen" are different students — and
 * a wrong merge hands one of them the other's place on the roster.
 */
export function rankCanvasCandidates(
  student: { name: string; email: string },
  candidates: CandidateRow[]
): RankedCandidate[] {
  // A course-code row is named after its address, which carries no name signal.
  const studentName = student.name.includes("@") ? "" : letters(student.name);
  const studentStem = stem(localPart(student.email));

  return candidates
    .map((c) => {
      const candidateName = letters(c.name);
      const candidateStem = stem(localPart(c.email));
      let score = 0;

      if (studentName && candidateName) {
        if (studentName === candidateName) score += 100;
        else if (
          studentName.length >= 6 &&
          candidateName.length >= 6 &&
          (studentName.includes(candidateName) ||
            candidateName.includes(studentName))
        ) {
          score += 60;
        }
      }

      if (studentStem === candidateStem) score += 90;
      else if (overlaps(studentStem, candidateStem, 5)) score += 55;

      // A surname shared with the address is a real signal: Meredith Freeman
      // against mfreem4.
      if (studentName && candidateStem.length >= 4) {
        const surname = letters(student.name.split(/\s+/).slice(-1)[0] ?? "");
        if (surname.length >= 4 && candidateStem.includes(surname.slice(0, 5))) {
          score += 45;
        }
      }

      return { ...c, score, confident: score >= 90 };
    })
    .sort((a, b) => b.score - a.score);
}
