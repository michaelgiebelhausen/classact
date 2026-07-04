import * as Sentry from "@sentry/nextjs";

/** Strip PII (emails, tokens, photo URLs) from Sentry events. */
export function scrubEvent<T extends Sentry.Event>(event: T): T {
  const scrub = (s: string) =>
    s
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
      .replace(/(token|key|secret|password)=[^&\s]+/gi, "$1=[redacted]")
      .replace(/profile-photos\/[^\s"']+/g, "profile-photos/[path]");
  if (event.message) event.message = scrub(event.message);
  if (event.request?.url) event.request.url = scrub(event.request.url);
  if (event.request?.headers) delete event.request.headers;
  if (event.user) event.user = { id: event.user.id };
  event.breadcrumbs = event.breadcrumbs?.map((b) => ({
    ...b,
    message: b.message ? scrub(b.message) : b.message,
    data: undefined,
  }));
  return event;
}

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return; // no-op until secrets are wired

  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  });
}

export const onRequestError = Sentry.captureRequestError;
