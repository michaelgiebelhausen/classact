/**
 * Slides as images for students — the pure parts.
 *
 * Students in the room don't need a faithful PDF: the projector carries the
 * fidelity, and the download button hands them the real file for later. So
 * the professor's browser rasterizes each page at upload into a WebP that a
 * student's tab loads one slide at a time, instead of the whole deck plus a
 * PDF engine. See supabase/migrations/0047_deck_rendered_pages.sql.
 */

/** Rendered width in CSS pixels. Text on a 13" laptop reads fine at this. */
export const DECK_PAGE_WIDTH = 1280;
/** WebP quality. Around 80 keeps a text slide near 60–120 KB. */
export const DECK_PAGE_QUALITY = 0.8;

/** Storage object for one rendered page, beside the PDF in lecture-decks. */
export function deckPagePath(
  courseId: string,
  deckId: string,
  page: number
): string {
  return `${courseId}/${deckId}/pages/${page}.webp`;
}

/**
 * Only a fully rendered deck is served as images. A partial set would need a
 * viewer that mixes images and PDF pages; falling back to the PDF for the
 * whole deck until rendering finishes is simpler and only costs the old
 * behaviour for the minute or two rendering takes.
 */
export function pagesReady(
  renderedPages: number,
  pageCount: number | null
): boolean {
  return pageCount !== null && pageCount > 0 && renderedPages >= pageCount;
}

/**
 * Which pages to have in the browser cache around the current one, so the
 * professor's next click is instant and a backwards step doesn't flash.
 * Ahead is weighted over behind: lectures move forward.
 */
export function prefetchPages(
  page: number,
  total: number,
  ahead = 2,
  behind = 1
): number[] {
  const out: number[] = [];
  for (let p = page + 1; p <= Math.min(total, page + ahead); p++) out.push(p);
  for (let p = page - 1; p >= Math.max(1, page - behind); p--) out.push(p);
  return out;
}
