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
export type GameType = "memory_tiles" | "flash_cards"

export type ProfileRow = {
  id: string
  role: Role
  full_name: string | null
  onboarding_complete: boolean
  created_at: string
}

export type CourseRow = {
  id: string
  professor_id: string
  name: string
  term: string | null
  join_code: string
  icebreaker_fields: string[]
  created_at: string
}

export type SeatRow = {
  id: string
  course_id: string
  label: string
  row_index: number
  col_index: number
}

export type EnrollmentRow = {
  id: string
  course_id: string
  profile_id: string | null
  roster_name: string
  roster_email: string
  status: EnrollmentStatus
  roster_photo_path: string | null
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
      enrollments: TableShape<EnrollmentRow>
      profile_photos: TableShape<ProfilePhotoRow>
      student_answers: TableShape<StudentAnswerRow>
      class_sessions: TableShape<ClassSessionRow>
      check_ins: TableShape<CheckInRow>
      seat_verifications: TableShape<SeatVerificationRow>
      name_game_scores: TableShape<NameGameScoreRow>
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
