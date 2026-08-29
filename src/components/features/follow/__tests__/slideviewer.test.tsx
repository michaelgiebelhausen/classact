import { render, waitFor, act } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SlideViewer } from "@/components/features/follow/SlideViewer";

// Shared render-promise controller. pdf.js renders are mocked so we can hold a
// page's render "in flight" and assert what the visible canvas does meanwhile.
const h = vi.hoisted(() => {
  const resolvers = new Map<number, () => void>();
  const hold = new Set<number>();
  return {
    resolvers,
    hold,
    renderPromise(n: number) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      resolvers.set(n, resolve);
      if (!hold.has(n)) resolve();
      return promise;
    },
  };
});

// getViewport width is page*100 so each page renders to a distinguishable size.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 10,
      destroy: () => {},
      getPage: async (n: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: n * 100 * scale,
          height: n * 50 * scale,
        }),
        render: () => ({ promise: h.renderPromise(n), cancel: () => {} }),
      }),
    }),
    destroy: () => {},
  }),
}));

beforeAll(() => {
  // jsdom has no real 2D context; a stub is enough for the blit path.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  })) as unknown as HTMLCanvasElement["getContext"];
});

describe("SlideViewer", () => {
  it("keeps the last painted frame while the next page is still rendering", async () => {
    h.resolvers.clear();
    h.hold.clear();

    const { container, rerender } = render(
      <SlideViewer fileUrl="https://x.test/deck.pdf?token=a" page={1} />
    );
    const canvas = container.querySelector("canvas")!;

    // Page 1 renders and is blitted onto the visible canvas.
    await waitFor(() => expect(canvas.width).toBe(100));

    // Advance to page 2 but hold its render in flight.
    h.hold.add(2);
    rerender(
      <SlideViewer fileUrl="https://x.test/deck.pdf?token=a" page={2} />
    );

    // Wait until page 2's render has actually started (but not finished).
    await waitFor(() => expect(h.resolvers.has(2)).toBe(true));

    // The visible canvas must NOT have been blanked/resized — it still shows
    // the last good frame (page 1) while page 2 rasterizes off-screen.
    expect(canvas.width).toBe(100);

    // Once page 2 finishes, its frame is swapped in.
    await act(async () => {
      h.resolvers.get(2)!();
      await Promise.resolve();
    });
    await waitFor(() => expect(canvas.width).toBe(200));
  });
});
