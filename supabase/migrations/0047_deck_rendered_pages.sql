-- Slides as images for students.
--
-- Every student used to download the whole deck PDF plus 1.6 MB of PDF
-- rendering machinery to follow along — 1 to 5 GB across a 300-seat room on
-- one access point in the first minute of class. The professor's browser now
-- rasterizes each page at upload into a WebP stored beside the PDF at
-- `{courseId}/{deckId}/pages/{n}.webp` in the lecture-decks bucket (the
-- existing folder-scoped storage policies already cover it: professor writes,
-- course members read). This column records how many pages exist, so the
-- student view can switch to images only once the whole deck is ready and
-- fall back to the PDF for anything older or still rendering.
--
-- The PDF stays the source of truth: the projector, the professor and the
-- "download slides" button all keep using it.

alter table public.lecture_decks
  add column if not exists rendered_pages int not null default 0;
