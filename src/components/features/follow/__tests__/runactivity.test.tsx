import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RunActivityControl } from "@/components/features/follow/RunActivityControl";
import { PollStageStepper } from "@/components/features/follow/PollStageStepper";
import type { PresenterQuestion } from "@/components/features/follow/ProfessorPresenter";
import type { PollStage } from "@/types/db";

/**
 * The professor's words were "it is not clear how that happens". These tests
 * are about that sentence: there is a control, it is visible, it lists what
 * can be run, and running one does what it says.
 */

const QUESTIONS: PresenterQuestion[] = [
  {
    id: "q1",
    prompt: "What limits the reaction rate here?",
    options: ["A", "B"],
    correctIndices: [0],
    positionAfterPage: 3,
  },
  {
    id: "q2",
    prompt: "Which assumption breaks first?",
    options: ["A", "B"],
    correctIndices: [1],
    positionAfterPage: 7,
  },
];

function setup(overrides: Partial<React.ComponentProps<typeof RunActivityControl>> = {}) {
  const handlers = {
    onLaunchQuestion: vi.fn(),
    onWriteQuestion: vi.fn(),
    onOpenChange: vi.fn(),
  };
  render(
    <RunActivityControl
      queued={QUESTIONS}
      pollOpen={false}
      exerciseOpen={false}
      busy={false}
      courseId="course-1"
      defaultOpen
      {...handlers}
      {...overrides}
    />
  );
  return handlers;
}

describe("RunActivityControl", () => {
  it("puts a launch control in reach during a live lecture", () => {
    setup({ defaultOpen: false });
    expect(
      screen.getByRole("button", { name: /run activity/i })
    ).toBeInTheDocument();
  });

  it("lists queued questions with the slide they belong to", () => {
    setup();
    expect(
      screen.getByText("What limits the reaction rate here?")
    ).toBeInTheDocument();
    expect(screen.getByText("After slide 3")).toBeInTheDocument();
    expect(screen.getByText("After slide 7")).toBeInTheDocument();
  });

  it("launches the question that was chosen", () => {
    const { onLaunchQuestion } = setup();
    fireEvent.click(screen.getByText("Which assumption breaks first?"));
    expect(onLaunchQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ id: "q2" })
    );
  });

  it("still offers a way to ask something with an empty bank", () => {
    // The empty case must not be a dead end — this is the professor who
    // never curates a bank, which is most of them.
    setup({ queued: [] });
    expect(
      screen.getByText(/no approved questions for this deck yet/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/write a question now/i)).toBeInTheDocument();
  });

  it("opens the write-your-own flow", () => {
    const { onWriteQuestion } = setup();
    fireEvent.click(screen.getByText(/write a question now/i));
    expect(onWriteQuestion).toHaveBeenCalledOnce();
  });

  it("steps aside while a poll is running", () => {
    // The command strip owns the round; two launch surfaces would be able to
    // disagree about what is on screen.
    setup({ pollOpen: true, defaultOpen: false });
    expect(
      screen.queryByRole("button", { name: /run activity/i })
    ).not.toBeInTheDocument();
  });

  it("hides the group exercise until it is wired up", () => {
    setup();
    expect(screen.queryByText(/one-minute paper/i)).not.toBeInTheDocument();
  });

  it("offers the group exercise when a handler is given", () => {
    setup({ onStartExercise: vi.fn() });
    expect(screen.getByText(/one-minute paper/i)).toBeInTheDocument();
  });

  it("says why the group exercise is unavailable rather than just greying out", () => {
    setup({ onStartExercise: vi.fn(), exerciseOpen: true });
    expect(screen.getByText(/one is already running/i)).toBeInTheDocument();
  });

  it("hands the keyboard back when the menu closes", () => {
    // While it's open the presenter suppresses arrow keys, so it has to hear
    // about the close or the deck stays frozen.
    const { onOpenChange } = setup();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("PollStageStepper", () => {
  it.each<[PollStage, string]>([
    ["think", "Think"],
    ["pair", "Pair & discuss"],
    ["revote", "Re-vote"],
    ["reveal", "Reveal"],
  ])("marks %s as the current step", (stage, label) => {
    render(<PollStageStepper stage={stage} />);
    const current = screen.getByText(label).closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
  });

  it("shows the whole arc, so what comes next is never a surprise", () => {
    render(<PollStageStepper stage="think" />);
    for (const label of ["Think", "Pair & discuss", "Re-vote", "Reveal"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("disappears once the round is closed", () => {
    const { container } = render(<PollStageStepper stage="closed" />);
    expect(container).toBeEmptyDOMElement();
  });
});
