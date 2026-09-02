import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  ExerciseStudent,
  type MyExerciseGroup,
} from "@/components/features/participate/ExerciseStudent";

/**
 * The one-minute paper is answered on a different page from the lecture, so
 * the professor closing it has to reach the student sitting here — otherwise
 * the box stays live-looking, every keystroke saves into a rejection, and the
 * only way back to the slides is the icon rail.
 */

/** Realtime callbacks the component registered, keyed by table. */
const handlers = new Map<string, (payload: unknown) => void>();

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    channel: () => {
      const channel = {
        on: (
          _event: string,
          config: { table: string },
          cb: (payload: unknown) => void
        ) => {
          handlers.set(config.table, cb);
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));

vi.mock("@/server/actions/exercises", () => ({
  saveExerciseResponse: vi.fn(async () => ({ ok: true })),
}));

const GROUP: MyExerciseGroup = {
  groupId: "group-1",
  label: "Group 3",
  prompt: "What was the muddiest point in today's lecture?",
  memberNames: ["Ada", "Grace"],
  response: "Entropy, mostly.",
};

function setup(
  overrides: Partial<React.ComponentProps<typeof ExerciseStudent>> = {}
) {
  render(
    <ExerciseStudent
      courseId="course-1"
      roundId="round-1"
      group={GROUP}
      openButUngrouped={false}
      lectureLive
      {...overrides}
    />
  );
}

/** The professor's "Close exercise", as it arrives over realtime. */
function closeTheRound() {
  act(() => {
    handlers.get("exercise_rounds")?.({ new: { stage: "closed" } });
  });
}

function answerBox() {
  return screen.getByPlaceholderText(/your group's answer/i);
}

beforeEach(() => handlers.clear());

describe("ExerciseStudent", () => {
  it("takes the group's answer while the round is open", () => {
    setup();
    expect(answerBox()).not.toHaveAttribute("readonly");
    expect(
      screen.queryByRole("link", { name: /back to the lecture/i })
    ).not.toBeInTheDocument();
  });

  // The promise this change exists to keep: when the paper is over, the way
  // back to the lecture is on screen, not hidden in a 62px icon rail.
  it("offers the way back once the professor closes the round", () => {
    setup();
    closeTheRound();
    const back = screen.getByRole("link", { name: /back to the lecture/i });
    expect(back).toHaveAttribute("href", "/course/course-1/follow");
  });

  it("locks the box instead of saving into a closed round", () => {
    setup();
    closeTheRound();
    expect(answerBox()).toHaveAttribute("readonly");
    expect(screen.getByText(/this exercise is closed/i)).toBeInTheDocument();
    // The answer stays readable — it's the group's work, not a cleared form.
    expect(answerBox()).toHaveValue("Entropy, mostly.");
  });

  it("keeps quiet about a lecture that isn't running", () => {
    setup({ lectureLive: false });
    closeTheRound();
    expect(screen.getByText(/this exercise is closed/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /back to the lecture/i })
    ).not.toBeInTheDocument();
  });

  it("clears itself away for an ungrouped student when the round ends", () => {
    setup({ group: null, openButUngrouped: true });
    expect(screen.getByText(/a group exercise is running/i)).toBeInTheDocument();
    closeTheRound();
    expect(
      screen.queryByText(/a group exercise is running/i)
    ).not.toBeInTheDocument();
  });
});
