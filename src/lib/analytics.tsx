"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/** Funnel + magic-moment events. No-ops when PostHog isn't configured. */
export type AnalyticsEvent =
  | "course_created"
  | "roster_imported"
  | "onboarding_completed"
  | "checkin_completed"
  | "neighbor_verified"
  | "game_played"
  | "deck_uploaded"
  | "lecture_started"
  | "lecture_ended"
  | "lecture_focus_lost";

export function capture(event: AnalyticsEvent, props?: Record<string, unknown>) {
  if (!KEY) return;
  posthog.capture(event, props);
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return;
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: true,
      persistence: "localStorage",
      autocapture: false, // deliberate: only the named funnel events + pageviews
    });
  }, []);
  return <>{children}</>;
}
