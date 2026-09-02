import { describe, expect, it } from "vitest";
import { reconcileOccupants, rowToOccupant } from "@/lib/checkinpoll";

const row = (
  id: string,
  enrollmentId: string,
  seatId: string,
  extra: Partial<{
    verified: boolean;
    denied_count: number | null;
    professor_confirmed_at: string | null;
  }> = {}
) => ({
  id,
  enrollment_id: enrollmentId,
  seat_id: seatId,
  verified: extra.verified ?? false,
  denied_count: extra.denied_count ?? 0,
  professor_confirmed_at: extra.professor_confirmed_at ?? null,
});

describe("rowToOccupant", () => {
  it("maps a check_ins row onto the map's occupant shape", () => {
    expect(
      rowToOccupant(
        row("c1", "e1", "s1", {
          verified: true,
          denied_count: null,
          professor_confirmed_at: "2026-09-02T13:00:00Z",
        })
      )
    ).toEqual({
      id: "c1",
      enrollmentId: "e1",
      seatId: "s1",
      verified: true,
      deniedCount: 0,
      professorConfirmed: true,
    });
  });
});

describe("reconcileOccupants", () => {
  it("returns the same map when nothing changed, so React skips the render", () => {
    const prev = new Map([["s1", rowToOccupant(row("c1", "e1", "s1"))]]);
    expect(reconcileOccupants(prev, [row("c1", "e1", "s1")])).toBe(prev);
  });

  it("adds arrivals and drops rows the server no longer has", () => {
    const prev = new Map([["s1", rowToOccupant(row("c1", "e1", "s1"))]]);
    const next = reconcileOccupants(prev, [row("c2", "e2", "s2")]);
    expect(next).not.toBe(prev);
    expect([...next.keys()]).toEqual(["s2"]);
    expect(next.get("s2")?.enrollmentId).toBe("e2");
  });

  it("moves a student to their new seat without leaving a ghost behind", () => {
    const prev = new Map([["s1", rowToOccupant(row("c1", "e1", "s1"))]]);
    const next = reconcileOccupants(prev, [row("c1", "e1", "s9")]);
    expect([...next.keys()]).toEqual(["s9"]);
  });

  it("picks up a verification flip on an otherwise identical row", () => {
    const prev = new Map([["s1", rowToOccupant(row("c1", "e1", "s1"))]]);
    const next = reconcileOccupants(prev, [
      row("c1", "e1", "s1", { verified: true }),
    ]);
    expect(next).not.toBe(prev);
    expect(next.get("s1")?.verified).toBe(true);
  });
});

describe("applyCheckInBroadcast", () => {
  it("upserts rows and evicts deleted ids in one step", async () => {
    const { applyCheckInBroadcast } = await import("@/lib/checkinpoll");
    const prev = new Map([
      ["s1", rowToOccupant(row("c1", "e1", "s1"))],
      ["s2", rowToOccupant(row("c2", "e2", "s2"))],
    ]);
    const next = applyCheckInBroadcast(prev, {
      upsert: [row("c3", "e3", "s3", { verified: true })],
      delete: ["c2"],
    });
    expect(next).not.toBe(prev);
    expect([...next.keys()].sort()).toEqual(["s1", "s3"]);
    expect(next.get("s3")?.verified).toBe(true);
  });

  it("moves a student to a new seat without leaving them in the old one", async () => {
    const { applyCheckInBroadcast } = await import("@/lib/checkinpoll");
    const prev = new Map([["s1", rowToOccupant(row("c1", "e1", "s1"))]]);
    const next = applyCheckInBroadcast(prev, {
      upsert: [row("c1", "e1", "s7")],
      delete: [],
    });
    expect([...next.keys()]).toEqual(["s7"]);
  });

  it("returns the same map when the payload changes nothing", async () => {
    const { applyCheckInBroadcast } = await import("@/lib/checkinpoll");
    const prev = new Map([["s1", rowToOccupant(row("c1", "e1", "s1"))]]);
    expect(
      applyCheckInBroadcast(prev, { upsert: [row("c1", "e1", "s1")], delete: ["zzz"] })
    ).toBe(prev);
  });
});
