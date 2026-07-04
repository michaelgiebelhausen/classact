import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./instrumentation";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
