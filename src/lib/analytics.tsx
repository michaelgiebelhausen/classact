"use client";

import { useEffect } from "react";
import type { PostHog } from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/** Funnel + magic-moment events. No-ops when PostHog isn't configured. */
export type AnalyticsEvent =
  | "course_created"
  | "roster_imported"
  | "onboarding_completed"
  | "checkin_completed"
  | "neighbor_verified"
  | "neighbor_denied"
  | "professor_confirmed_attendance"
  | "arrival_toast_shown"
  | "game_played"
  | "deck_uploaded"
  | "lecture_started"
  | "lecture_paused"
  | "lecture_resumed"
  | "lecture_ended"
  | "lecture_focus_lost"
  | "reading_attached"
  | "tps_questions_generated"
  | "poll_launched"
  | "poll_answered"
  | "poll_revealed"
  | "exercise_started"
  | "project_uploaded"
  | "project_tasks_generated"
  | "transcript_attached"
  | "syllabus_uploaded"
  | "ta_asked"
  | "ta_indexed";

/**
 * PostHog is loaded on demand, after the page is interactive, and only when
 * a key is configured. Imported statically it rode in the shared chunk of
 * every route — ~60 KB gzipped that 300 laptops on one access point paid
 * before the check-in map could render, even on a deployment with no key.
 */
let client: Promise<PostHog | null> | null = null;

function load(): Promise<PostHog | null> {
  if (!KEY) return Promise.resolve(null);
  if (!client) {
    client = import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(KEY, {
          api_host: HOST,
          capture_pageview: true,
          persistence: "localStorage",
          autocapture: false, // deliberate: only the named funnel events + pageviews
        });
        return posthog;
      })
      .catch(() => null);
  }
  return client;
}

export function capture(event: AnalyticsEvent, props?: Record<string, unknown>) {
  if (!KEY) return;
  void load().then((posthog) => posthog?.capture(event, props));
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return;
    // Let the page settle first; the first pageview still lands within a
    // second and nothing in the classroom path waits on it.
    const timer = setTimeout(() => void load(), 800);
    return () => clearTimeout(timer);
  }, []);
  return <>{children}</>;
}
