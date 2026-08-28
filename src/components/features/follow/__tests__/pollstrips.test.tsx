import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PollCommandStrip } from "@/components/features/follow/PollCommandStrip";
import { PollOfferStrip } from "@/components/features/follow/PollOfferStrip";
import { nextStageAction } from "@/lib/presenternav";
import type { PollStage } from "@/types/db";

/**
 * Unit tests can prove the navigation rules; they cannot prove there is a
 * button on screen to act on them. That gap is what stranded a lecture — the
 * only way out of a running poll was a grey link below the fold — so these
 * tests assert the affordances themselves.
 */

const LIVE_STAGES: PollStage[] = ["think", "pair", "revote", "reveal"];

function renderStrip(
  stage: PollStage,
  overrides: Partial<React.ComponentProps<typeof PollCommandStrip>> = {}
) {
  const handlers = {
    onAdvanceStage: vi.fn(),
    onReveal: vi.fn(),
    onResume: vi.fn(),
    onEndPoll: vi.fn(),
  };
  render(
    <PollCommandStrip
      prompt="Which force dominates at this scale?"
      stage={stage}
      answered={12}
      total={30}
      busy={false}
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe("PollCommandStrip", () => {
  // The promise this whole change exists to keep: from any stage, without
  // scrolling, there is a live control that returns the room to the slides.
  it.each(LIVE_STAGES)("offers a way back to the slides during %s", (stage) => {
    const { onEndPoll } = renderStrip(stage);
    const exit = screen.getByRole("button", {
      name: /end poll & show slides/i,
    });
    expect(exit).toBeEnabled();
    fireEvent.click(exit);
    expect(onEndPoll).toHaveBeenCalledOnce();
  });

  it.each(LIVE_STAGES)("shows the next move during %s", (stage) => {
    renderStrip(stage);
    const label = nextStageAction(stage)?.label ?? "";
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("advances the stage the professor is actually on", () => {
    const { onAdvanceStage } = renderStrip("think");
    fireEvent.click(screen.getByRole("button", { name: /pair & discuss/i }));
    expect(onAdvanceStage).toHaveBeenCalledWith("pair");
  });

  it("opens the re-vote from the pair stage", () => {
    const { onAdvanceStage } = renderStrip("pair");
    fireEvent.click(screen.getByRole("button", { name: /open re-vote/i }));
    expect(onAdvanceStage).toHaveBeenCalledWith("revote");
  });

  it("reveals from re-vote", () => {
    const { onReveal } = renderStrip("revote");
    fireEvent.click(screen.getByRole("button", { name: /reveal results/i }));
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("resumes the lecture from reveal", () => {
    const { onResume } = renderStrip("reveal");
    fireEvent.click(screen.getByRole("button", { name: /resume lecture/i }));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("shows the question and how many have answered", () => {
    renderStrip("think");
    expect(
      screen.getByText("Which force dominates at this scale?")
    ).toBeInTheDocument();
    expect(screen.getByText(/12 of 30 answered/i)).toBeInTheDocument();
  });

  it("disables its actions while a request is in flight", () => {
    renderStrip("think", { busy: true });
    expect(
      screen.getByRole("button", { name: /end poll & show slides/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /pair & discuss/i })
    ).toBeDisabled();
  });

  it("renders nothing for a closed round", () => {
    const { container } = render(
      <PollCommandStrip
        prompt="x"
        stage="closed"
        answered={0}
        total={0}
        busy={false}
        onAdvanceStage={vi.fn()}
        onReveal={vi.fn()}
        onResume={vi.fn()}
        onEndPoll={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

function renderOffer(
  overrides: Partial<React.ComponentProps<typeof PollOfferStrip>> = {}
) {
  const onRun = vi.fn();
  const onSkip = vi.fn();
  render(
    <PollOfferStrip
      prompt="Why does the curve flatten here?"
      count={1}
      alreadyAdvanced={false}
      nextPage={5}
      busy={false}
      onRun={onRun}
      onSkip={onSkip}
      {...overrides}
    />
  );
  return { onRun, onSkip };
}

describe("PollOfferStrip", () => {
  it("previews the question before anything takes over the room", () => {
    renderOffer();
    expect(
      screen.getByText("Why does the curve flatten here?")
    ).toBeInTheDocument();
  });

  it("runs only when asked", () => {
    const { onRun, onSkip } = renderOffer();
    fireEvent.click(screen.getByRole("button", { name: /run question/i }));
    expect(onRun).toHaveBeenCalledOnce();
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("names the slide the professor moves on to", () => {
    const { onSkip } = renderOffer();
    fireEvent.click(
      screen.getByRole("button", { name: /continue to slide 5/i })
    );
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("counts extra questions waiting at the same slide", () => {
    renderOffer({ count: 3 });
    expect(screen.getByText(/\+2 more/)).toBeInTheDocument();
  });

  it("dismisses instead of continuing when the slide already moved", () => {
    renderOffer({ alreadyAdvanced: true });
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue to slide/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/previous slide/i)).toBeInTheDocument();
  });
});
