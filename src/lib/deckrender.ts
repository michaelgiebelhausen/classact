"use client";

import { createClient } from "@/lib/supabase/browser";
import { DECK_BUCKET } from "@/lib/storage";
import {
  DECK_PAGE_QUALITY,
  DECK_PAGE_WIDTH,
  deckPagePath,
} from "@/lib/deckpages";
import { setDeckRenderedPages } from "@/server/actions/lectures";

export interface RenderDeckOptions {
  courseId: string;
  deckId: string;
  /** The PDF bytes (a just-uploaded File) or a URL to fetch them from. */
  source: File | string;
  /** Pages already rendered; rendering resumes after them. */
  from?: number;
  onProgress?: (rendered: number, total: number) => void;
  /** Set to true to stop after the current page. */
  signal?: AbortSignal;
}

/** How often the deck row learns of progress; the final count always lands. */
const REPORT_EVERY = 5;

/**
 * Rasterize a deck in the professor's browser and upload one WebP per page.
 *
 * Runs here rather than on a server on purpose: the upload flow already
 * opens the PDF with pdf.js to count pages, the professor's laptop is the
 * only machine that does this work and does it once, and a serverless
 * renderer would need a native PDF library plus a queue to survive a
 * 100-page deck. Pages upload as they finish, and the deck row's
 * rendered_pages count follows, so an interrupted run resumes where it
 * stopped and students keep the PDF path until the whole deck is ready.
 *
 * Resolves to the number of pages rendered in total (including any already
 * done). Throws only if the PDF itself can't be opened.
 */
export async function renderDeckPages(opts: RenderDeckOptions): Promise<number> {
  const { courseId, deckId, source, onProgress, signal } = opts;
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const data =
    typeof source === "string"
      ? await fetch(source).then((r) => r.arrayBuffer())
      : await source.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;
  const total = doc.numPages;
  const supabase = createClient();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D isn't available in this browser.");

  let rendered = Math.max(0, opts.from ?? 0);
  let reportedAt = rendered;
  const report = async (force: boolean) => {
    if (!force && rendered - reportedAt < REPORT_EVERY) return;
    reportedAt = rendered;
    await setDeckRenderedPages(courseId, deckId, rendered).catch(() => {});
  };

  try {
    for (let p = rendered + 1; p <= total; p++) {
      if (signal?.aborted) break;
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const scale = DECK_PAGE_WIDTH / base.width;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", DECK_PAGE_QUALITY)
      );
      if (!blob) throw new Error("Couldn't encode a slide image.");
      const { error } = await supabase.storage
        .from(DECK_BUCKET)
        .upload(deckPagePath(courseId, deckId, p), blob, {
          contentType: "image/webp",
          upsert: true,
          cacheControl: "31536000",
        });
      if (error) throw new Error(error.message);

      rendered = p;
      onProgress?.(rendered, total);
      await report(false);
    }
  } finally {
    await report(true);
    void loadingTask.destroy();
  }
  return rendered;
}
