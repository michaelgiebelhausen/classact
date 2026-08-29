import { afterEach, describe, expect, it, vi } from "vitest";
import { onWake, subscribeWithRecovery } from "@/lib/live-sync";

// Minimal stand-in for a Supabase realtime channel/client. removeChannel fires
// the channel's status callback with "CLOSED", mirroring @supabase/realtime-js.
type FakeChannel = {
  name: string;
  cb: ((s: string) => void) | null;
  on: () => FakeChannel;
  subscribe: (cb: (s: string) => void) => FakeChannel;
  fire: (s: string) => void;
};

function makeFakeClient() {
  const channels: FakeChannel[] = [];
  const client = {
    channel(name: string) {
      const ch: FakeChannel = {
        name,
        cb: null,
        on: () => ch,
        subscribe(cb) {
          ch.cb = cb;
          return ch;
        },
        fire: (s) => ch.cb?.(s),
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch: FakeChannel) {
      // The real client fires the channel's status callback with CLOSED here.
      ch.cb?.("CLOSED");
    },
  };
  // The helper is typed against the real RealtimeChannel; the fake is
  // structurally compatible for what it touches (channel/removeChannel/subscribe).
  return { client: client as never, channels };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

afterEach(() => {
  setVisibility("visible");
});

describe("onWake", () => {
  it("fires with source 'foreground' when the tab becomes visible again", () => {
    const fn = vi.fn();
    const stop = onWake(fn);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledExactlyOnceWith("foreground");
    stop();
  });

  it("does NOT fire on a visibilitychange into the background", () => {
    const fn = vi.fn();
    const stop = onWake(fn);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it("fires on window focus (foreground) and on network coming back (online), tagged distinctly", () => {
    const fn = vi.fn();
    const stop = onWake(fn);
    setVisibility("visible");
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "foreground");
    expect(fn).toHaveBeenNthCalledWith(2, "online");
    stop();
  });

  it("removes every listener on cleanup", () => {
    const fn = vi.fn();
    const stop = onWake(fn);
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("subscribeWithRecovery", () => {
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  function start(catchUp = vi.fn()) {
    const { client, channels } = makeFakeClient();
    const onStatus = vi.fn();
    const cleanup = subscribeWithRecovery({
      client,
      topic: (g) => `t:${g}`,
      bind: () => {},
      catchUp,
      onStatus,
    });
    return { channels, catchUp, onStatus, cleanup };
  }

  it("catches up on every SUBSCRIBED and falls back to polling when it isn't", () => {
    vi.useFakeTimers();
    const { channels, catchUp } = start();

    channels[0].fire("SUBSCRIBED");
    expect(catchUp).toHaveBeenCalledTimes(1); // caught up once live

    channels[0].fire("CHANNEL_ERROR"); // dropped → 5s poll fallback arms
    vi.advanceTimersByTime(5000);
    expect(catchUp).toHaveBeenCalledTimes(2);

    channels[0].fire("SUBSCRIBED"); // back → catch up again, poll cleared
    vi.advanceTimersByTime(10000);
    expect(catchUp).toHaveBeenCalledTimes(3);
  });

  it("does NOT re-arm the poll timer when a torn-down channel fires CLOSED on cleanup", () => {
    vi.useFakeTimers();
    const { channels, catchUp, cleanup } = start();

    channels[0].fire("SUBSCRIBED"); // live, no poll timer
    expect(catchUp).toHaveBeenCalledTimes(1);

    cleanup(); // removeChannel fires channels[0] CLOSED — must be ignored
    vi.advanceTimersByTime(60000);
    // No leaked interval: catchUp not called again after teardown.
    expect(catchUp).toHaveBeenCalledTimes(1);
  });

  it("ignores a retired channel's status after a wake rebounce, and rebounces on online", () => {
    vi.useFakeTimers();
    const { channels, catchUp, onStatus } = start();
    channels[0].fire("SUBSCRIBED");
    expect(channels).toHaveLength(1);

    // Network returns: rebounce onto a fresh channel (channels[1]).
    window.dispatchEvent(new Event("online"));
    expect(channels).toHaveLength(2);
    channels[1].fire("SUBSCRIBED");

    // The retired channel now emits a late error — must not wedge live=false or
    // start a phantom poll timer.
    onStatus.mockClear();
    channels[0].fire("CHANNEL_ERROR");
    expect(onStatus).not.toHaveBeenCalled();
    const before = catchUp.mock.calls.length;
    vi.advanceTimersByTime(60000);
    expect(catchUp).toHaveBeenCalledTimes(before);
  });

  it("collapses the focus+visibilitychange pair but never suppresses online", () => {
    vi.useFakeTimers();
    const { channels } = start();
    channels[0].fire("SUBSCRIBED");

    // focus + visibilitychange on one foreground return → a single rebounce.
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(channels).toHaveLength(2);

    // online right after must still rebounce (not collapsed with foreground).
    window.dispatchEvent(new Event("online"));
    expect(channels).toHaveLength(3);
  });
});
