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
  if (dsn) {
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend: (event) => scrubEvent(event),
    });
  }

  // Does the database have the columns this build reads? Migrations are
  // applied by hand, so a deploy can arrive ahead of its migration — and
  // when it does the queries return empty rather than failing, which reads
  // as "nobody has checked in" instead of "this is broken". Ask once per
  // server instance, before anyone's class depends on the answer.
  //
  // Node runtime only: the check needs the service role key and the
  // Supabase admin client, neither of which belongs in an edge bundle.
  //
  // Awaited in development, where stopping the developer is the entire point
  // and a second of latency costs nothing. NOT awaited in production:
  // `register()` must finish before the instance serves its first request,
  // so awaiting would put a database round trip in front of every cold start
  // — including the ones Vercel creates while forty students check in at
  // once. There it runs in the background and the answer is waiting by the
  // time a page asks for it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertSchemaAtBoot } = await import("@/server/schemaguard");
    if (process.env.NODE_ENV === "production") void assertSchemaAtBoot();
    else await assertSchemaAtBoot();
  }
}

export const onRequestError = Sentry.captureRequestError;
