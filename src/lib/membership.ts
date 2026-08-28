/**
 * Who you are is where you belong.
 *
 * ClassAct used to carry a single `profiles.role` — one word on your account
 * saying "student" or "professor" for the whole app, chosen by you, at
 * sign-up, before you had ever seen the product. Two things were wrong with
 * that, and the second is the one that matters.
 *
 * The small one: the sign-up toggle defaulted to "A professor". Anyone who
 * typed an email and a password and pressed the only button on the form
 * became a professor without ever making a choice. That is how students kept
 * "somehow" turning into professors — the answer was pre-filled and the
 * question read like a label. A professor in the AI Tools class picked the
 * honest answer and got the same trap from the other side, because the flag
 * is global: it made him a professor in a class he was attending.
 *
 * The real one: a global flag cannot describe a person. The same human is a
 * professor in the course they run on Tuesday and a student in the one they
 * sit in on Thursday, and no single word on their account is true in both
 * rooms. The flag also had to be *maintained* — hence becomeProfessor(),
 * becomeStudent(), and a guard to stop a professor demoting themselves out
 * from under a live class. All of that was upkeep for a fact the database
 * already knew.
 *
 * So it is derived now, per course, from the only two records that were ever
 * the truth:
 *
 *   - You are the professor of a course iff `courses.professor_id` is you.
 *   - You are a student of a course iff you hold a non-dropped enrollment.
 *
 * Both can be true of the same person in different courses, which is the
 * point. Nothing is declared, so nothing can be declared wrong; there is no
 * state to repair, and no way back into the trap. Note that this was already
 * how every permission in the app worked — every course page gates on
 * `course.professor_id === profile.id`. The global role never granted access
 * to anybody else's data. What it decided was which app you were shown, which
 * is why being wrong about it stranded people instead of exposing anything.
 */

export interface Membership {
  /** Courses this person owns — they are the professor of each. */
  coursesTaught: number;
  /** Non-dropped enrollments this person holds, across all courses. */
  classesJoined: number;
}

/** Do they run anything? Governs professor-shaped surfaces (AI keys, Canvas). */
export function teaches(m: Membership): boolean {
  return m.coursesTaught > 0;
}

/** Do they attend anything? Governs student-shaped surfaces (onboarding). */
export function attends(m: Membership): boolean {
  return m.classesJoined > 0;
}

/**
 * A brand-new account belongs to nothing yet, so there is no dashboard to
 * draw and no way to guess which half of the product they came for. Ask —
 * once, in the moment, with both doors labelled — instead of having asked at
 * sign-up and stored the answer forever.
 *
 * Asking here rather than at sign-up is the whole fix. The question is
 * attached to an action they are about to take, so a wrong answer costs one
 * tap of the Back button; it isn't written to their account, so it cannot
 * follow them into next semester.
 */
export function needsChooser(m: Membership): boolean {
  return !teaches(m) && !attends(m);
}

/**
 * Onboarding — photos, name pronunciation, icebreakers — exists so classmates
 * can learn you. It's owed once you are actually in somebody's class, and not
 * before.
 *
 * Keyed on attendance, not on "isn't a professor", which is what the old gate
 * meant by `role === 'student'`. That distinction is the difference between a
 * professor being marched through student icebreakers on their way to
 * building their first course (the old behaviour, had the role ever been
 * wrong) and a professor who joins a colleague's class as a student getting
 * onboarded for that class — correctly, because in that room they are one.
 */
export function needsOnboarding(
  m: Membership,
  onboardingComplete: boolean
): boolean {
  return attends(m) && !onboardingComplete;
}
