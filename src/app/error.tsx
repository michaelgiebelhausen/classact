"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Something broke on our end.
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Not you — us. Try again, and if it keeps happening your professor can
        let us know.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
