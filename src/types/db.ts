/**
 * Hand-authored Supabase database types, mirroring supabase/migrations/0001_init.sql.
 * NOTE: type aliases (not interfaces) — postgrest-js needs implicit index
 * signatures, which interfaces don't provide.
 * Once live Supabase keys exist, regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/types/db.ts
 */

/**
 * @deprecated Inert as of migration 0035. Nothing reads it.
 *
 * Roles are derived per course now — you're the professor of a course iff
 * `courses.professor_id` is you, and a student of one iff you hold a
 * non-dropped enrollment. See src/lib/membership.ts. The column and this type
 * survive only so the row shape still matches the table; they will go
 * together in a later migration. Do not reach for either.
 */
export type Role = "student" | "professor"
export type EnrollmentStatus = "invited" | "active" | "dropped"
export type PhotoKind = "candid" | "professional" | "adventure"
export type SeatRelation = "front" | "back" | "left" | "right"
export type GameType = "memory_tiles" | "flash_cards" | "matching"
export type DeckKind = "pdf" | "google_slides"
export type FocusEventType = "away" | "back"
export type QuestionSource = "ai" | "professor"
export type PollStage = "think" | "pair" | "revote" | "reveal" | "closed"
export type PollPhase = "think" | "revote"
export type ProjectStatus = "draft" | "open"
export type ProjectTaskSource = "ai" | "professor"
export type TeamTaskSource = "ai" | "professor" | "team"
export type TeamTaskStatus = "unassigned" | "assigned" | "done"
export type TeamRole = "lead" | "member"

export type RoomSource = "professor" | "ai_import" | "seed"

export type ProfileRow = {
  id: string
  /** @deprecated Inert since 0035 — see the note on `Role`. */
  role: Role
  full_name: string | null
  /** Given/family names the person edits separately (0042). full_name is
   *  composed from them on save; null on rows not edited since the migration. */
  first_name: string | null
  last_name: string | null
  name_phonetic: string | null
  /** How each name part is said, edited separately (0043). name_phonetic is
   *  composed from these on save; null on rows not edited since the migration. */
  first_name_phonetic: string | null
  last_name_phonetic: string | null
  onboarding_complete: boolean
  university_id: string | null
  /** Founder accounts run course AI on the system env key. */
  founder: boolean
  /** Comped accounts bypass the billing gate. */
  comp: boolean
  stripe_customer_id: string | null
  subscription_status: string | null
  /** Self-entered LinkedIn profile, shown to coursemates. */
  linkedin_url: string | null
  /** Official institutional address as Canvas lists it (0032). May differ from
   *  the address this account signs in with. */
  school_email: string | null
  /** When ownership of school_email was established; null = claimed but
   *  unproven, which is currently allowed. */
  school_email_verified_at: string | null
  created_at: string
}

/** BYOK vault row — service-role access only (RLS has no policies). */
export type ProfessorAiRow = {
  id: string
  profile_id: string
  key_ciphertext: string
  key_last4: string
  models: Record<string, unknown>
  updated_at: string
}

/** The Markdown file a person attaches to their own profile (0034). Owner-only
 *  under RLS; kept off `profiles` because getProfile() selects every column. */
export type ProfileDocumentRow = {
  profile_id: string
  filename: string
  content: string
  content_bytes: number
  updated_at: string
}

/** Profile-level icebreaker answer (professors; students answer per course). */
export type ProfileAnswerRow = {
  profile_id: string
  field_key: string
  value: string
  updated_at: string
}

export type FeedbackKind = "bug" | "improvement" | "feature"
export type FeedbackStatus = "new" | "planned" | "done" | "closed"

export type FeedbackRow = {
  id: string
  profile_id: string
  kind: FeedbackKind
  body: string
  page_path: string | null
  status: FeedbackStatus
  created_at: string
}

export type ProfessorCanvasRow = {
  profile_id: string
  base_url: string
  token_ciphertext: string
  token_last4: string
  connected_name: string | null
  updated_at: string
}

export type CourseRow = {
  id: string
  professor_id: string
  name: string
  term: string | null
  join_code: string
  icebreaker_fields: string[]
  room_id: string | null
  /** Weekdays the class meets, 0 = Sunday … 6 = Saturday. */
  meeting_days: number[]
  meeting_start: string | null
  meeting_end: string | null
  timezone: string | null
  auto_open: boolean
  /** Inclusive term bounds, "YYYY-MM-DD"; null = runs indefinitely. */
  term_start: string | null
  term_end: string | null
  /** Course-level Tasty Grading defaults (cut points, weights, windows). */
  grading_defaults: Record<string, unknown>
  /** Professor's participation-score weights (competency key → 0..1). */
  participation_weights: Record<string, unknown>
  /** Attendance policy the AI applies to self-reported absences (0025). */
  attendance_policy: Record<string, unknown>
  /** The professor's invite email, tokens ({name}, {course}, {link}, {code})
   * left unrendered. Null = send the shipped default (0026). */
  invite_subject: string | null
  invite_message: string | null
  /** 0040 — professor toggle: may students download lecture transcripts? */
  transcripts_downloadable: boolean
  /** 0041 — Ask the TA is opt-in: a connected key alone must not switch on
   *  student-facing chat spend. Default false. */
  ta_enabled: boolean
  syllabus_path: string | null
  syllabus_title: string | null
  /** 0040 — TA-corpus text; can be very long, keep out of broad selects. */
  syllabus_text: string | null
  /** Canvas linkage from the last roster sync (0027): which Canvas course
   * (and which sections of a cross-listed shell) this roster came from, so
   * resync is one click. Null = never synced from Canvas. */
  canvas_course_id: string | null
  canvas_section_ids: string[] | null
  canvas_synced_at: string | null
  /** Professor's dashboard sort order (0028); ties fall back to created_at. */
  position: number
  created_at: string
}

export type AbsenceCategory =
  | "athletics"
  | "interview"
  | "university_event"
  | "religious"
  | "family"
  | "illness"
  | "bereavement"
  | "other"
export type AbsenceVerdict = "excused" | "unexcused"

/** A self-reported absence (0025). Documentation is never stored. */
export type AbsenceRow = {
  id: string
  course_id: string
  enrollment_id: string
  /** "YYYY-MM-DD" in the course timezone. */
  absence_date: string
  category: AbsenceCategory
  explanation: string
  submitted_at: string
  /** Hours before the meeting start; negative = after class began. */
  advance_hours: number | null
  has_documentation: boolean
  documentation_kind: string | null
  ai_doc_authenticity: number | null
  ai_verdict: AbsenceVerdict
  ai_legitimacy: number
  ai_summary: string
  ai_reason: string
  ai_flags: string[]
  appeal_note: string | null
  appealed_at: string | null
  professor_verdict: AbsenceVerdict | null
  professor_note: string | null
  decided_at: string | null
  attended_elsewhere: boolean
  created_at: string
  updated_at: string
}

export type ShoutOutContext = "general" | "exercise" | "project" | "peer_review"

export type ShoutOutRow = {
  id: string
  course_id: string
  giver_enrollment_id: string
  recipient_enrollment_id: string
  context: ShoutOutContext
  context_id: string | null
  message: string
  created_at: string
}

export type ParticipationComparisonRow = {
  id: string
  course_id: string
  left_enrollment_id: string
  right_enrollment_id: string
  /** −2..+2, positive = right student participates better. */
  verdict: number
  created_at: string
}

export type StudentFlagRow = {
  id: string
  course_id: string
  enrollment_id: string
  reason: string
  created_at: string
  resolved_at: string | null
}

// ---------------------------------------------------------------------------
// Tasty Grading (docs/tasty-grading-plan.md)
// ---------------------------------------------------------------------------

export type AssignmentState =
  | "open"
  | "analyzing"
  | "awaiting_key"
  | "peer_review"
  | "finalizing"
  | "published"
export type PairType = "exceptional" | "self" | "refine" | "professor"
export type ThemeProvenance = "professor" | "class" | "both"

/** One criterion in a taste file: a named standard in the student's words. */
export type TasteCriterion = { name: string; standard: string }

export type AssignmentRow = {
  id: string
  course_id: string
  title: string
  storage_path: string | null
  /** 0033 — the student-facing brief, plain text. Distinct from
   *  settings.gradingInstructions, which is the professor's private AI
   *  grading criteria and must never be shown to a student. */
  instructions: string
  /** 0033 — what the assignment is worth. Null = no value set, which is
   *  not the same fact as zero. Feeds nothing yet. */
  points: number | null
  /** 0033 — the Canvas gradebook column this maps to, retained in a CSV
   *  header so a re-export updates rather than duplicates. */
  canvas_assignment_id: string | null
  /** 0033 — when we last generated a Canvas CSV. Not proof Canvas got it:
   *  the professor uploads by hand and never reports back. */
  canvas_exported_at: string | null
  deadline: string
  peer_close_at: string
  settings: Record<string, unknown>
  state: AssignmentState
  analysis: Record<string, unknown>
  published_at: string | null
  created_at: string
}

export type TasteFileRow = {
  id: string
  assignment_id: string
  course_id: string
  /** Null = the professor's optional benchmark taste file. */
  enrollment_id: string | null
  /** Free-flowing taste, in the author's own words. Null = a legacy
   *  structured row — read it through tasteProse(), never raw. */
  body: string | null
  /** Legacy structured criteria, kept for rows written before 0037. */
  criteria: TasteCriterion[]
  /** Legacy. */
  bar_statement: string
  is_default_untouched: boolean
  first_edit_at: string | null
  last_edit_at: string | null
  /** When the student sealed this taste file (co-created gate). Null =
   *  unlocked and still editable; write-once, and frozen once set (0045). */
  locked_at: string | null
  created_at: string
}

export type SubmissionRow = {
  id: string
  assignment_id: string
  course_id: string
  enrollment_id: string
  storage_path: string
  note: string
  submitted_at: string
  last_edit_at: string
}

/** An item evidencing a theme: a student's own sentence. */
export type ThemeItem = { quote: string; enrollment_id: string | null }

export type RubricThemeRow = {
  id: string
  assignment_id: string
  course_id: string
  name: string
  description: string
  provenance: ThemeProvenance
  items: ThemeItem[]
  position: number
  created_at: string
}

export type ThemeScore = { themeId: string; score: number; evidence: string }

export type AiScoreRow = {
  id: string
  assignment_id: string
  course_id: string
  submission_id: string
  theme_scores: ThemeScore[]
  overall: number
  own_bar: number | null
  distinctiveness: number | null
  /** 0–10; 5 = the student's own bar matches the instructor's, >5 higher,
   *  <5 lower. Null = not computed. An assessment of the taste, not the work
   *  (0045). Inherits ai_scores' publish gate. */
  standards_score: number | null
  standards_note: string
  summary: string
  created_at: string
}

export type ComparisonRow = {
  id: string
  assignment_id: string
  course_id: string
  /** Null = the professor judging. */
  judge_enrollment_id: string | null
  left_submission_id: string
  right_submission_id: string
  pair_type: PairType
  position: number
  /** −2..+2, "right is clearly worse" … "right is clearly better"; null = undecided. */
  verdict: number | null
  assigned_at: string
  decided_at: string | null
}

export type RankingRow = {
  id: string
  assignment_id: string
  course_id: string
  submission_id: string
  bt_score: number
  /** The model's draft order — recomputed on every verdict. */
  rank: number
  /** The professor's materialized order, set when peer review closes and
   *  never overwritten by a recompute. Null until then; read as
   *  `final_rank ?? rank`. */
  final_rank: number | null
  /** Written only at publish, from the order and the bands. */
  points_awarded: number | null
  /** The band's label at publish ("A", "Excellent", or none). */
  letter: string | null
  updated_at: string
}

export type RubricViewRow = {
  id: string
  assignment_id: string
  course_id: string
  enrollment_id: string
  seconds: number
  first_viewed_at: string
}

/** Neighbor seat labels by relation — persisted, layout-agnostic adjacency. */
export type SeatNeighbors = Partial<Record<SeatRelation, string>>

export type SeatRow = {
  id: string
  course_id: string
  label: string
  row_index: number | null
  col_index: number | null
  x: number | null
  y: number | null
  section: string
  table_id: string | null
  neighbors: SeatNeighbors
}

export type UniversityRow = {
  id: string
  name: string
  domain: string | null
  created_at: string
}

export type BuildingRow = {
  id: string
  university_id: string
  name: string
  created_at: string
}

export type RoomRow = {
  id: string
  building_id: string | null
  room_number: string | null
  layout: unknown
  layout_version: number
  capacity: number
  layout_type: string
  source: RoomSource
  verified: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export type EnrollmentRow = {
  id: string
  course_id: string
  profile_id: string | null
  roster_name: string
  roster_email: string
  status: EnrollmentStatus
  roster_photo_path: string | null
  roster_name_phonetic: string | null
  /** Receipt for the last invite attempt (0026): when it was accepted by the
   * mail provider, or why it wasn't. Never both. */
  invited_at: string | null
  invite_error: string | null
  /** When the professor confirmed this student dropped (0027). Cleared on
   * reactivation (re-added in Canvas, or rejoined with the course code). */
  dropped_at: string | null
  /** When a Canvas sync first stopped finding them (0030). Cleared the moment
   * Canvas lists them again, so a bad token doesn't leave a false accusation. */
  canvas_missing_since: string | null
  /** Last time a Canvas sync matched or imported them (0031). Null means
   * Canvas never listed them — joined by code, or added by CSV — so they can
   * never be a Canvas departure. */
  canvas_seen_at: string | null
  /** 0033 — the Canvas user id, which a gradebook CSV uses as its "ID"
   *  column to match a row to a student. Populated by the roster sync;
   *  null for anyone Canvas never listed. */
  canvas_user_id: string | null
  created_at: string
}

export type ProfilePhotoRow = {
  id: string
  profile_id: string
  kind: PhotoKind
  storage_path: string
  created_at: string
}

export type StudentAnswerRow = {
  id: string
  enrollment_id: string
  field_key: string
  value: string
}

export type ClassSessionRow = {
  id: string
  course_id: string
  session_date: string
  opened_at: string
  closed_at: string | null
}

export type CheckInRow = {
  id: string
  session_id: string
  enrollment_id: string
  seat_id: string
  is_new_seat: boolean
  verified: boolean
  checked_in_at: string
  /** 0036 — active "not in that seat" reports; recounted by trigger. */
  denied_count: number
  /** 0036 — set once by professor_confirm_attendance; never unset. */
  professor_confirmed_at: string | null
}

export type SeatVerificationRow = {
  id: string
  session_id: string
  verifier_enrollment_id: string
  subject_enrollment_id: string
  relation: SeatRelation
  created_at: string
}

/** 0036 — a neighbor's report that the claimed person isn't in the seat.
 *  Never deleted: resolved (with a reason) when any confirmation supersedes
 *  it, so disputes keep their audit trail. */
export type SeatDenialRow = {
  id: string
  session_id: string
  verifier_enrollment_id: string
  subject_enrollment_id: string
  relation: SeatRelation
  created_at: string
  resolved_at: string | null
  resolved_by:
    | 'peer_confirm'
    | 'professor_confirm'
    | 'seat_change'
    | 'checkin_removed'
    | null
}

export type NameGameScoreRow = {
  id: string
  enrollment_id: string
  game_type: GameType
  score: number
  duration_ms: number | null
  played_at: string
}

export type LectureDeckRow = {
  id: string
  course_id: string
  title: string
  kind: DeckKind
  storage_path: string | null
  embed_url: string | null
  page_count: number | null
  /** 0047 — pages rasterized to images for students (lib/deckpages). */
  rendered_pages: number
  reading_path: string | null
  reading_title: string | null
  transcript_path: string | null
  transcript_title: string | null
  /** 0040 — text bodies for the TA corpus; can run 100k+ chars each. Never
   *  add these to a select that feeds a page render. */
  transcript_text: string | null
  deck_text: string | null
  reading_text: string | null
  /** Manual order within the course (0 = first); professors drag to set it. */
  position: number
  created_at: string
}

/** 0040 — one turn in a member's private Ask-the-TA thread. */
export type TaMessageRow = {
  id: string
  course_id: string
  profile_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

/** One professor-declared pause window; an open pause has end null. */
export type LecturePause = { start: string; end: string | null }

export type LectureRow = {
  id: string
  course_id: string
  deck_id: string
  current_page: number
  started_at: string
  ended_at: string | null
  pauses: LecturePause[]
}

export type LectureNoteEntryRow = {
  id: string
  lecture_id: string
  enrollment_id: string
  /** The slide on screen when the note was typed; null for imported freeform notes. */
  page: number | null
  content: string
  created_at: string
  updated_at: string
}

export type FocusEventRow = {
  id: string
  lecture_id: string
  enrollment_id: string
  event_type: FocusEventType
  occurred_at: string
}

export type LecturePresenceRow = {
  lecture_id: string
  enrollment_id: string
  last_seen_at: string
}

export type DeckQuestionRow = {
  id: string
  deck_id: string
  course_id: string
  prompt: string
  options: string[]
  correct_indices: number[]
  rationale: string | null
  position_after_page: number
  approved: boolean
  source: QuestionSource
  created_at: string
}

export type PollResults = {
  think: number[]
  revote: number[]
}

export type PollRoundRow = {
  id: string
  lecture_id: string
  course_id: string
  question_id: string | null
  prompt: string
  options: string[]
  stage: PollStage
  correct_indices: number[] | null
  results: PollResults | null
  started_at: string
  revealed_at: string | null
  closed_at: string | null
}

export type PollAnswerRow = {
  id: string
  round_id: string
  enrollment_id: string
  phase: PollPhase
  choice: number
  answered_at: string
}

export type PollPairRow = {
  id: string
  round_id: string
  course_id: string
  member_ids: string[]
  created_at: string
}

export type ProjectRow = {
  id: string
  course_id: string
  title: string
  storage_path: string | null
  page_count: number | null
  due_date: string | null
  target_team_size: number | null
  contract_text: string
  status: ProjectStatus
  created_at: string
}

export type ProjectTaskRow = {
  id: string
  project_id: string
  course_id: string
  title: string
  description: string | null
  estimated_minutes: number
  position: number
  source: ProjectTaskSource
  created_at: string
}

export type ProjectTeamRow = {
  id: string
  project_id: string
  course_id: string
  name: string
  contract_text: string
  created_at: string
}

export type ProjectTeamMemberRow = {
  id: string
  team_id: string
  project_id: string
  enrollment_id: string
  role: TeamRole
  created_at: string
}

export type TeamTaskRow = {
  id: string
  team_id: string
  project_id: string
  course_id: string
  source_task_id: string | null
  title: string
  description: string | null
  estimated_minutes: number
  actual_minutes: number | null
  status: TeamTaskStatus
  assigned_enrollment_id: string | null
  assigned_by_enrollment_id: string | null
  done_at: string | null
  position: number
  source: TeamTaskSource
  created_at: string
}

export type TaskFlagRow = {
  id: string
  team_task_id: string
  course_id: string
  flagged_by_enrollment_id: string
  reason: string
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export type TeamContractSignatureRow = {
  id: string
  team_id: string
  enrollment_id: string
  signed_at: string
}

export type ExerciseStage = "open" | "closed"

export type ExerciseRoundRow = {
  id: string
  course_id: string
  session_id: string | null
  prompt: string
  stage: ExerciseStage
  created_at: string
  closed_at: string | null
}

export type ExerciseGroupRow = {
  id: string
  round_id: string
  course_id: string
  label: string
  created_at: string
}

export type ExerciseGroupMemberRow = {
  id: string
  group_id: string
  course_id: string
  enrollment_id: string
  created_at: string
}

export type ExerciseResponseRow = {
  id: string
  group_id: string
  round_id: string
  course_id: string
  content: string
  updated_by_enrollment_id: string | null
  updated_at: string
}

type TableShape<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles: TableShape<ProfileRow>
      courses: TableShape<CourseRow>
      seats: TableShape<SeatRow>
      universities: TableShape<UniversityRow>
      buildings: TableShape<BuildingRow>
      rooms: TableShape<RoomRow>
      enrollments: TableShape<EnrollmentRow>
      profile_photos: TableShape<ProfilePhotoRow>
      profile_documents: TableShape<ProfileDocumentRow>
      student_answers: TableShape<StudentAnswerRow>
      class_sessions: TableShape<ClassSessionRow>
      check_ins: TableShape<CheckInRow>
      seat_verifications: TableShape<SeatVerificationRow>
      seat_denials: TableShape<SeatDenialRow>
      name_game_scores: TableShape<NameGameScoreRow>
      lecture_decks: TableShape<LectureDeckRow>
      lectures: TableShape<LectureRow>
      lecture_note_entries: TableShape<LectureNoteEntryRow>
      ta_messages: TableShape<TaMessageRow>
      focus_events: TableShape<FocusEventRow>
      lecture_presence: TableShape<LecturePresenceRow>
      deck_questions: TableShape<DeckQuestionRow>
      poll_rounds: TableShape<PollRoundRow>
      poll_answers: TableShape<PollAnswerRow>
      poll_pairs: TableShape<PollPairRow>
      projects: TableShape<ProjectRow>
      project_tasks: TableShape<ProjectTaskRow>
      project_teams: TableShape<ProjectTeamRow>
      project_team_members: TableShape<ProjectTeamMemberRow>
      team_tasks: TableShape<TeamTaskRow>
      task_flags: TableShape<TaskFlagRow>
      team_contract_signatures: TableShape<TeamContractSignatureRow>
      exercise_rounds: TableShape<ExerciseRoundRow>
      exercise_groups: TableShape<ExerciseGroupRow>
      exercise_group_members: TableShape<ExerciseGroupMemberRow>
      exercise_responses: TableShape<ExerciseResponseRow>
      assignments: TableShape<AssignmentRow>
      taste_files: TableShape<TasteFileRow>
      submissions: TableShape<SubmissionRow>
      rubric_themes: TableShape<RubricThemeRow>
      ai_scores: TableShape<AiScoreRow>
      comparisons: TableShape<ComparisonRow>
      rankings: TableShape<RankingRow>
      rubric_views: TableShape<RubricViewRow>
      shout_outs: TableShape<ShoutOutRow>
      participation_comparisons: TableShape<ParticipationComparisonRow>
      student_flags: TableShape<StudentFlagRow>
      professor_ai: TableShape<ProfessorAiRow>
      professor_canvas: TableShape<ProfessorCanvasRow>
      feedback: TableShape<FeedbackRow>
      absences: TableShape<AbsenceRow>
      profile_answers: TableShape<ProfileAnswerRow>
    }
    Views: { [_ in never]: never }
    Functions: {
      /** 0029 — professor moves a student between seats, swapping if the
       *  target is occupied. Atomic; authorizes the caller internally. */
      reassign_seat: {
        Args: { p_session: string; p_enrollment: string; p_seat: string }
        Returns: undefined
      }
      /** 0036 — professor vouches for a checked-in student from the map;
       *  resolves active denials. Authorizes the caller internally. */
      professor_confirm_attendance: {
        Args: { p_session: string; p_enrollment: string }
        Returns: undefined
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
