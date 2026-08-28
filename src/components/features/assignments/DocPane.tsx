"use client";

import { useEffect, useState } from "react";

/**
 * One submission, rendered. PDFs in a frame, Markdown as the readable plain
 * text that is the format's whole point, images inline. Shared by the
 * side-by-side comparison and the single-submission speed view, so a
 * professor reads the same thing either way.
 */

/** Mirror of the server DocKind (kept local so the client bundle stays clean). */
export type PairDocKind = "pdf" | "md" | "png" | "jpeg";

interface Props {
  url: string | null;
  /** Names the pane for screen readers: "Left", "Right", a student's name. */
  label: string;
  kind?: PairDocKind;
  /** Tailwind height class — the speed view runs taller than a pair. */
  heightClass?: string;
}

function MdPane({
  url,
  label,
  heightClass,
}: {
  url: string;
  label: string;
  heightClass: string;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then((t) => setText(t.slice(0, 200_000)))
      .catch(() => setText("Couldn't load this file — reopen it."));
    return () => controller.abort();
  }, [url]);
  if (text === null) {
    return (
      <div className={`grid ${heightClass} place-items-center text-sm text-muted-foreground`}>
        Loading…
      </div>
    );
  }
  return (
    <pre
      aria-label={`${label} submission (Markdown)`}
      className={`${heightClass} w-full overflow-auto whitespace-pre-wrap p-4 font-sans text-sm leading-relaxed`}
    >
      {text}
    </pre>
  );
}

export function DocPane({
  url,
  label,
  kind = "pdf",
  heightClass = "h-[540px]",
}: Props) {
  if (!url) {
    return (
      <div className={`grid ${heightClass} place-items-center text-sm text-muted-foreground`}>
        Loading…
      </div>
    );
  }
  if (kind === "md") {
    return <MdPane url={url} label={label} heightClass={heightClass} />;
  }
  if (kind === "png" || kind === "jpeg") {
    return (
      <div className={`grid ${heightClass} place-items-center overflow-auto bg-muted/20 p-2`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
        <img
          src={url}
          alt={`${label} submission (image)`}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  return (
    <iframe
      src={url}
      title={`${label} submission`}
      className={`${heightClass} w-full`}
    />
  );
}
