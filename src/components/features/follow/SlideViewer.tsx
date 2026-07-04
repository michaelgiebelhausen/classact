"use client";

import { useEffect, useRef, useState } from "react";
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
}

/**
 * Renders one page of a PDF deck to a canvas, sized to its container.
 * pdf.js is imported dynamically so it never runs during SSR.
 */
export function SlideViewer({ fileUrl, page, onPageCount, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [docVersion, setDocVersion] = useState(0);

  // Load the document once per file URL.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        setStatus("loading");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        const loadingTask = pdfjs.getDocument({ url: fileUrl });
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
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
    // onPageCount is intentionally not a dependency — reload only on new file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

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
        const scale = width / baseViewport.width;
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: scale * dpr });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        renderTaskRef.current?.cancel();
        const task = pdfPage.render({ canvas, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch {
        // Render cancellations are expected when pages change quickly.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, docVersion]);

  return (
    <div ref={containerRef} className={className}>
      {status === "loading" && (
        <div className="grid aspect-video place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
          Loading slides…
        </div>
      )}
      {status === "error" && (
        <div className="grid aspect-video place-items-center rounded-lg bg-muted text-sm text-muted-foreground">
          Couldn&apos;t load the deck. Refresh to retry.
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={status === "ready" ? "w-full rounded-lg shadow-sm" : "hidden"}
      />
    </div>
  );
}
