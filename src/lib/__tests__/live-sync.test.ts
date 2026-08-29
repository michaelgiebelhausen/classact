import { afterEach, describe, expect, it, vi } from "vitest";
import { onWake } from "@/lib/live-sync";

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
  it("fires when the tab becomes visible again", () => {
    const fn = vi.fn();
    const stop = onWake(fn);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledTimes(1);
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

  it("fires on window focus (foreground return) and on network coming back", () => {
    const fn = vi.fn();
    const stop = onWake(fn);
    setVisibility("visible");
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    expect(fn).toHaveBeenCalledTimes(2);
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
