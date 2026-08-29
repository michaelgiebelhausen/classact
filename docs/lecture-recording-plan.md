# Lecture recording → transcript (plan, not built)

Status: **design only** (2026-08-29). Decided with Mike: build the student
"Download slides" buttons now; write this up and defer the build.

## Concept

A per-course setting: "Record my lectures." When on, starting a lecture in the
professor's presenter view begins capturing microphone audio in their browser.
Audio uploads in chunks during the lecture, is transcribed server-side, and the
raw transcript attaches to the lecture. Students get a "Download transcript"
button alongside slides and notes.

## Architecture sketch

1. **Setting** — boolean on `courses` (e.g. `record_lectures`), toggled in
   Course Setup (`CourseSetupTabs.tsx`). Professor-only.
2. **Capture (client)** — in the presenter view, `MediaRecorder` (audio-only,
   `audio/webm;codecs=opus`, ~0.5–1 MB/min) with a ~60s timeslice. Each chunk
   uploads immediately to a new **private `lecture-audio` bucket**
   (`{courseId}/{lectureId}/{seq}.webm`): professor-only RLS write,
   service-role read. Upload queue with retry; chunks already uploaded survive
   a dead tab or dropped wifi, and the transcript notes the gap. A visible
   "Recording" indicator is mandatory UX.
3. **Transcription (server)** — transcribe **per chunk as it lands** rather
   than one giant job at lecture end; this sidesteps serverless timeouts and
   means the transcript is essentially done when the lecture ends. Segments go
   to a `lecture_transcript_segments` table (`lecture_id, seq, text,
   started_at`); a finalize step at lecture end stitches them into one raw
   transcript stored on the lecture (or as a `.md` in storage).
   - **Provider decision needed**: Whisper-class STT (~$0.006/min ⇒ ~$0.45 per
     75-min lecture) vs. Gemini audio via OpenRouter, which fits the existing
     BYOK pattern (`src/server/aicreds.ts`) — the professor pays via their own
     key, ClassAct's cost stays zero.
4. **Student access** — "Download transcript" button (same signed-URL pattern
   as the slides download) once finalized; professor gets a preview and a
   per-lecture "share with students" toggle (default shared — that's the
   point — the toggle covers a bad-audio day).
5. **Retention** — delete raw audio chunks once transcription succeeds. The
   transcript is the artifact; this caps storage growth and shrinks the
   privacy footprint.

## Risks / open questions (resolve before building)

- **Consent** — mics capture student voices and questions. In-app notice,
  advise professors to announce recording, and check institutional policy
  before piloting.
- **Reliability** — laptop sleep, tab backgrounding across a 75-minute
  lecture, Bluetooth mic dropouts. Needs an in-classroom dry run before any
  student-facing promise.
- **Provider quality/cost** — test Whisper vs. Gemini on real classroom audio
  (distance from mic, cross-talk).
- **Timing alignment (later)** — chunk timestamps could map transcript
  segments to slide numbers (the follow-along system knows the current page),
  making transcripts page-stamped like notes. Not v1.
- **Migration number** — re-check the latest number in
  `supabase/migrations/` immediately before writing; parallel sessions
  collide.

## Estimate

Roughly 3–5 focused sessions: capture + upload (1–2), transcription pipeline
(1–2), student surface + settings + polish (1). Plus one in-classroom dry run.

## Related context

- NotebookLM has **no public API** for adding sources; the strategy for
  "students feed this to NotebookLM" is frictionless downloads (slides, notes,
  and eventually transcripts), not a direct integration. Re-check Google's
  offerings before building phase 3.
- Notes already export as Markdown by download and by email to any address
  (`NotesArchive.tsx`, `emailNotesExport`), which covers the local-download
  and second-brain destinations today.
- A cheaper interim step, if transcripts are wanted sooner: let professors
  upload a transcript file they recorded elsewhere (e.g. Pixel Recorder) as an
  extra lecture material, reusing the deck-upload pattern.
