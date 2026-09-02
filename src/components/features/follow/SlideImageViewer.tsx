"use client";

import { useEffect, useRef, useState } from "react";
import { prefetchPages } from "@/lib/deckpages";

interface Props {
  /** Signed URLs, index 0 = page 1. */
  pageUrls: string[];
  page: number;
  className?: string;
}

/**
 * The student's slide: one image per page, swapped only once the next one
 * has finished loading so an advance never flashes blank, with the next two
 * pages and the previous one warmed in the browser cache. This replaces the
 * PDF renderer for students whose deck was rasterized at upload — no PDF
 * engine, no whole-deck download, one ~100 KB image per slide as shown.
 */
export function SlideImageViewer({ pageUrls, page, className }: Props) {
  const total = pageUrls.length;
  const clamped = Math.min(Math.max(1, page), Math.max(1, total));
  const wanted = pageUrls[clamped - 1] ?? null;
  // What is actually on screen. Lags `wanted` until the new image has
  // decoded, so the last good slide stays up in between.
  const [shown, setShown] = useState<string | null>(wanted);
  const shownRef = useRef<string | null>(wanted);

  useEffect(() => {
    if (!wanted || wanted === shownRef.current) return;
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) return;
      shownRef.current = wanted;
      setShown(wanted);
    };
    img.onerror = () => {
      // Show it anyway; the browser's broken-image state beats a stale slide
      // that silently stops tracking the professor.
      if (cancelled) return;
      shownRef.current = wanted;
      setShown(wanted);
    };
    img.src = wanted;
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  // Warm the neighbours. Image objects held in a ref so the browser keeps the
  // cache entries alive between renders.
  const warmRef = useRef<Map<number, HTMLImageElement>>(new Map());
  useEffect(() => {
    if (total === 0) return;
    const keep = new Set<number>([clamped]);
    for (const p of prefetchPages(clamped, total)) {
      keep.add(p);
      if (!warmRef.current.has(p)) {
        const img = new Image();
        img.decoding = "async";
        img.src = pageUrls[p - 1];
        warmRef.current.set(p, img);
      }
    }
    for (const p of Array.from(warmRef.current.keys())) {
      if (!keep.has(p)) warmRef.current.delete(p);
    }
  }, [clamped, total, pageUrls]);

  if (!shown) {
    return (
      <div
        className={`flex aspect-video items-center justify-center rounded-lg border bg-muted text-sm text-muted-foreground ${className ?? ""}`}
      >
        Loading slides…
      </div>
    );
  }

  return (
    <div className={`overflow-hidden rounded-lg border bg-white ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, sized by CSS */}
      <img
        src={shown}
        alt={`Slide ${clamped} of ${total}`}
        className="block h-auto w-full"
        decoding="async"
        draggable={false}
      />
    </div>
  );
}
