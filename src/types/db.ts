/**
 * Hand-authored Supabase database types, mirroring supabase/migrations/0001_init.sql.
 * NOTE: type aliases (not interfaces) — postgrest-js needs implicit index
 * signatures, which interfaces don't provide.
 * Once live Supabase keys exist, regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/types/db.ts
 */

export type Role = "student" | "professor"
export type EnrollmentStatus = "invited" | "active"
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
  role: Role
  full_name: string | null
  name_phonetic: string | null
  onboarding_complete: boolean
  university_id: string | null
  created_at: string
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
  /** Course-level Tasty Grading defaults (cut points, weights, windows). */
  grading_defaults: Record<string, unknown>
  created_at: string
}

// ---------------------------------------------------------------------------
// Tasty Grading (docs/tasty-grading-plan.md)
// ---------------------------------------------------------------------------

export type AssignmentState =
  | "open"
  | "analyzing"
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
  criteria: TasteCriterion[]
  bar_statement: string
  is_default_untouched: boolean
  first_edit_at: string | null
  last_edit_at: string | null
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
  rank: number
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
}

export type SeatVerificationRow = {
  id: string
  session_id: string
  verifier_enrollment_id: string
  subject_enrollment_id: string
  relation: SeatRelation
  created_at: string
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
  reading_path: string | null
  reading_title: string | null
  created_at: string
}

export type LectureRow = {
  id: string
  course_id: string
  deck_id: string
  current_page: number
  started_at: string
  ended_at: string | null
}

export type LectureNoteRow = {
  id: string
  lecture_id: string
  enrollment_id: string
  content: string
  updated_at: string
}

export type FocusEventRow = {
  id: string
  lecture_id: string
  enrollment_id: string
  event_type: FocusEventType
  occurred_at: string
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
      student_answers: TableShape<StudentAnswerRow>
      class_sessions: TableShape<ClassSessionRow>
      check_ins: TableShape<CheckInRow>
      seat_verifications: TableShape<SeatVerificationRow>
      name_game_scores: TableShape<NameGameScoreRow>
      lecture_decks: TableShape<LectureDeckRow>
      lectures: TableShape<LectureRow>
      lecture_notes: TableShape<LectureNoteRow>
      focus_events: TableShape<FocusEventRow>
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
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
