import type { RealtimeChannel } from "@supabase/supabase-js";

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
export function onWake(
  handler: (source: "foreground" | "online") => void
): () => void {
  function onForeground() {
    // `focus` also fires when focus merely moves within an already-visible
    // page; gating on visibility keeps this to real foreground returns.
    if (document.visibilityState === "visible") handler("foreground");
  }
  function onOnline() {
    handler("online");
  }
  document.addEventListener("visibilitychange", onForeground);
  window.addEventListener("focus", onForeground);
  window.addEventListener("online", onOnline);
  return () => {
    document.removeEventListener("visibilitychange", onForeground);
    window.removeEventListener("focus", onForeground);
    window.removeEventListener("online", onOnline);
  };
}

interface RecoveryClient {
  channel: (name: string) => RealtimeChannel;
  removeChannel: (channel: RealtimeChannel) => unknown;
}

export interface RecoveryOptions {
  client: RecoveryClient;
  /** Builds a UNIQUE channel topic; `gen` increments on every (re)connect, so a
   *  rebounce never collides with the still-unsubscribing old channel. */
  topic: (gen: number) => string;
  /** Attach the site's postgres_changes handlers before the channel subscribes. */
  bind: (channel: RealtimeChannel) => void;
  /** Authoritative read: run once the channel is confirmed live, and every
   *  `pollMs` while it isn't. Must apply DB state (and guard its own staleness). */
  catchUp: () => void | Promise<void>;
  /** Optional connection-status hook, e.g. to drive a "reconnecting" badge. */
  onStatus?: (subscribed: boolean) => void;
  /** Fallback poll cadence while realtime is down (default 5s). */
  pollMs?: number;
}

/**
 * A realtime subscription that survives sleep, shutdown, and Wi-Fi drops.
 *
 * postgres_changes are never replayed, and a socket severed by an OS sleep may
 * never surface as a non-`SUBSCRIBED` status — so a plain `.subscribe()` goes
 * silently stale. This wrapper:
 *  - runs `catchUp()` on every `SUBSCRIBED` (initial join, Supabase auto-rejoin,
 *    or our own rebounce) so a missed change is re-read once the feed is live;
 *  - falls back to a `pollMs` timer whenever the channel isn't subscribed;
 *  - on returning to the foreground or the network (see {@link onWake}), retires
 *    the current channel and resubscribes on a fresh unique topic, so a zombie
 *    socket can't strand the view;
 *  - ignores the status callback of any channel it has retired. `removeChannel`
 *    fires that channel's callback with `CLOSED`; without this guard the stale
 *    callback would re-arm the poll timer *after* teardown (a per-tab interval
 *    leak) or wedge a healthy reconnect.
 *
 * Returns a cleanup to call on unmount.
 */
export function subscribeWithRecovery(opts: RecoveryOptions): () => void {
  const { client, topic, bind, catchUp, onStatus, pollMs = 5000 } = opts;
  let gen = 0;
  // Generation whose status callback is allowed to act; -1 means "none".
  let activeGen = -1;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let channel: RealtimeChannel;

  function connect(): RealtimeChannel {
    const myGen = gen++;
    activeGen = myGen;
    const ch = client.channel(topic(myGen));
    bind(ch);
    ch.subscribe((status) => {
      // A channel we've superseded or torn down still fires "CLOSED" — ignore it.
      if (myGen !== activeGen) return;
      const subscribed = status === "SUBSCRIBED";
      onStatus?.(subscribed);
      if (subscribed) {
        void catchUp();
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } else if (!pollTimer) {
        pollTimer = setInterval(() => void catchUp(), pollMs);
      }
    });
    return ch;
  }

  channel = connect();

  let lastForeground = 0;
  const stopWake = onWake((source) => {
    // focus + visibilitychange both fire on one foreground return; collapse
    // them. Never collapse `online`: a Wi-Fi return moments after the tab
    // foregrounds is exactly the moment that must re-read once the net is back.
    if (source === "foreground") {
      const now = Date.now();
      if (now - lastForeground < 1000) return;
      lastForeground = now;
    }
    activeGen = -1; // retire the current channel's callback before tearing it down
    client.removeChannel(channel);
    channel = connect();
  });

  return () => {
    stopWake();
    activeGen = -1;
    if (pollTimer) clearInterval(pollTimer);
    client.removeChannel(channel);
  };
}
