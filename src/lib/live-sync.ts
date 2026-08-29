/**
 * Run `handler` whenever the tab returns to the foreground or the network
 * comes back — the moments a machine that slept, shut down, or dropped Wi-Fi
 * needs to re-sync.
 *
 * Supabase realtime does NOT replay `postgres_changes` missed while a socket
 * was dead, and a socket severed by an OS sleep isn't reliably surfaced as a
 * non-`SUBSCRIBED` status — so a live view goes stale silently and never
 * recovers on its own (the "no computer is tracking the slides after it woke
 * up" bug). Pair this with an authoritative catch-up read and a channel
 * re-subscribe to recover.
 *
 * Returns a cleanup that removes every listener.
 */
export function onWake(handler: () => void): () => void {
  function onVisible() {
    // `focus` also fires when focus merely moves within an already-visible
    // page; gating on visibility keeps this to real foreground returns.
    if (document.visibilityState === "visible") handler();
  }
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("online", handler);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("online", handler);
  };
}
