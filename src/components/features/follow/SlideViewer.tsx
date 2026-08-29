"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";

interface Props {
  /** Signed URL of the deck PDF. */
  fileUrl: string;
  /** 1-based page to display. */
  page: number;
  /** Reports the real page count once the document loads. */
  onPageCount?: (count: number) => void;
  className?: string;
  /**
   * "width" (default) scales to the container's width; "contain" also caps by
   * the container's height — used by the projector stage view.
   */
  fit?: "width" | "contain";
}

/**
 * Renders one page of a PDF deck to a canvas, sized to its container.
 * pdf.js is imported dynamically so it never runs during SSR.
 */
export function SlideViewer({
  fileUrl,
  page,
  onPageCount,
  className,
  fit = "width",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  // Off-screen buffer we rasterize each page into. Only a fully-painted frame
  // is copied onto the visible canvas (see the render effect), so a render
  // that's interrupted — e.g. a slide advance while this tab is backgrounded —
  // can never leave the deck blank.
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Once a page has rendered we never blank the deck again: a background
  // reload keeps the last frame on screen instead of flashing a placeholder.
  const [everReady, setEverReady] = useState(false);
  const [docVersion, setDocVersion] = useState(0);
  const [resizeTick, setResizeTick] = useState(0);

  // The document's identity is the storage object, not the signed URL. Every
  // server render (e.g. any router.refresh() in the course) mints a fresh
  // signed URL with a new ?token — the same PDF. Reloading pdf.js on that
  // churn is what made the slide vanish behind "Loading slides…" mid-lecture.
  // Key the load on the path alone; load with whatever URL is current.
  const docKey = useMemo(() => fileUrl.split("?")[0], [fileUrl]);
  const fileUrlRef = useRef(fileUrl);
  useEffect(() => {
    fileUrlRef.current = fileUrl;
  }, [fileUrl]);

  // Re-render on window resize (e.g. the stage window dragged to a projector).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onResize() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setResizeTick((t) => t + 1), 150);
    }
    window.addEventListener("resize", onResize);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // A slide can advance while this tab is backgrounded, where the browser
  // throttles rasterization and the render may never finish. Re-render the
  // current page when we come back so it's guaranteed on screen.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden) setResizeTick((t) => t + 1);
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Load the document once per storage object (not per signed-URL token).
  useEffect(() => {
    let cancelled = false;
    // Hold onto the previously loaded doc so a genuine deck swap keeps its
    // last frame on the canvas until the new one is ready, rather than
    // clearing to a placeholder.
    const previousDoc = docRef.current;
    const previousTask = loadingTaskRef.current;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        // Only show the placeholder on the very first load; a reload keeps
        // the current slide visible.
        if (!docRef.current) setStatus("loading");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        const loadingTask = pdfjs.getDocument({ url: fileUrlRef.current });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        docRef.current = doc;
        onPageCount?.(doc.numPages);
        setDocVersion((v) => v + 1);
        setStatus("ready");
        setEverReady(true);
        // Retire the old document only now that its replacement can render.
        if (previousDoc && previousDoc !== doc) void previousTask?.destroy();
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
    // onPageCount is intentionally not a dependency — reload only on a new
    // storage object, not on signed-URL token rotation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);

  // Tear down pdf.js only on unmount — never on token churn.
  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, []);

  // Render the requested page whenever it (or the doc) changes.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container) return;

    let cancelled = false;
    (async () => {
      try {
        const pageNumber = Math.min(Math.max(1, page), doc.numPages);
        const pdfPage = await doc.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const width = container.clientWidth || baseViewport.width;
        const height = container.clientHeight || baseViewport.height;
        const scale =
          fit === "contain"
            ? Math.min(width / baseViewport.width, height / baseViewport.height)
            : width / baseViewport.width;
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: scale * dpr });

        // Rasterize into the off-screen buffer, leaving the visible canvas
        // untouched (still showing the last frame) until this one is done.
        const buffer =
          bufferRef.current ??
          (bufferRef.current = document.createElement("canvas"));
        buffer.width = viewport.width;
        buffer.height = viewport.height;

        renderTaskRef.current?.cancel();
        const task = pdfPage.render({ canvas: buffer, viewport });
        renderTaskRef.current = task;
        await task.promise;
        // A newer page superseded this one mid-render — its frame will land;
        // don't clobber the visible canvas with this stale one.
        if (cancelled) return;

        // The frame is complete: only now swap it onto the screen. Setting the
        // visible canvas size clears it, so we do it and blit in one go — the
        // deck never shows an empty frame.
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        canvas.getContext("2d")?.drawImage(buffer, 0, 0);
      } catch {
        // Render cancellations are expected when pages change quickly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, docVersion, fit, resizeTick]);

  return (
    <div ref={containerRef} className={className}>
      {status === "loading" && !everReady && (
        <div className="grid aspect-video place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
          Loading slides…
        </div>
      )}
      {status === "error" && !everReady && (
        <div className="grid aspect-video place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
          Couldn&apos;t load the deck. Refresh to retry.
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={
          !everReady
            ? "hidden"
            : fit === "contain"
              ? "max-h-full max-w-full"
              : "w-full rounded-lg shadow-sm"
        }
      />
    </div>
  );
}
