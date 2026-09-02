"use client";

import { useMemo } from "react";
import { EyeOff, Pause, Play } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatAwayDuration } from "@/lib/focus";
import { RoomMap, type RoomMapSeat } from "@/components/features/rooms/RoomMap";

/**
 * The presenter's classroom view: the seat map mirrored to the professor's
 * vantage (your front-row left = the map's left), each checked-in student
 * at their seat with their first name underneath and a red ring while
 * they're tabbed away. Students who never checked into a seat keep the old
 * list treatment below, so nobody goes invisible.
 */

export interface AttentionRow {
  enrollmentId: string;
  name: string;
  photoUrl: string | null;
  awayCount: number;
  awayMs: number;
  isAway: boolean;
  /** Heartbeat went silent — laptop asleep/closed/offline, not browsing. */
  disconnected: boolean;
}

interface Props {
  seats: RoomMapSeat[];
  /** seatId → enrollmentId for today's live session. */
  occupants: Record<string, string>;
  /** The presenter's live rows (already sorted: away first). */
  attention: AttentionRow[];
  paused: boolean;
  /** Toggle in flight — disables the button while the server round-trips. */
  pauseBusy: boolean;
  /** Pause or resume focus tracking (monitoring). */
  onTogglePause: () => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export function ClassroomAttention({
  seats,
  occupants,
  attention,
  paused,
  pauseBusy,
  onTogglePause,
}: Props) {
  const byEnrollment = useMemo(
    () => new Map(attention.map((a) => [a.enrollmentId, a])),
    [attention]
  );
  // Mirror left-right: the map is drawn from the students' orientation;
  // the professor at the front sees the room flipped.
  const mirrored = useMemo(() => seats.map((s) => ({ ...s, x: -s.x })), [seats]);
  const seated = useMemo(() => new Set(Object.values(occupants)), [occupants]);
  const unseated = attention.filter((a) => !seated.has(a.enrollmentId));
  const awayNow = attention.filter((a) => a.isAway).length;
  const disconnectedNow = attention.filter((a) => a.disconnected).length;
  const hasMap = seats.length > 0 && seated.size > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <EyeOff className="size-4" /> Attention
          </CardTitle>
          <Button
            size="sm"
            variant={paused ? "default" : "outline"}
            className={
              paused
                ? "shrink-0 bg-amber-500 text-white hover:bg-amber-500/90"
                : "shrink-0"
            }
            onClick={onTogglePause}
            disabled={pauseBusy}
          >
            {paused ? (
              <>
                <Play className="mr-1.5 size-4" /> Resume tracking
              </>
            ) : (
              <>
                <Pause className="mr-1.5 size-4" /> Pause focus tracking
              </>
            )}
          </Button>
        </div>
        <CardDescription>
          {paused
            ? "Focus tracking paused — students can browse freely; new tab-aways aren't counted."
            : (awayNow === 0
                ? "Everyone's tab is on the lecture."
                : `${awayNow} ${awayNow === 1 ? "student is" : "students are"} away right now.`) +
              (disconnectedNow > 0
                ? ` ${disconnectedNow} disconnected (asleep or offline).`
                : "")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {hasMap ? (
          <div className="grid gap-1.5">
            <div className="max-h-96 overflow-auto rounded-lg border p-2">
              <RoomMap
                seats={mirrored}
                captions
                frontLabel="You are here"
                ariaLabel="Live classroom attention map"
                stateFor={(seat) => {
                  const enrollmentId = occupants[seat.id];
                  if (!enrollmentId) return { kind: "empty", tappable: false };
                  const row = byEnrollment.get(enrollmentId);
                  const tally = row && row.awayCount > 0 ? ` · ${row.awayCount}×` : "";
                  return {
                    kind: "taken",
                    name: row?.name ?? "Student",
                    photoUrl: row?.photoUrl ?? null,
                    caption: row ? `${firstName(row.name)}${tally}` : "?",
                    alert: row?.isAway ?? false,
                    muted: row?.disconnected ?? false,
                  };
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Your view from the front · red ring = tabbed away right now ·
              dimmed = disconnected (laptop asleep or closed) ·
              &ldquo;2×&rdquo; = times away this lecture.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            The seat map appears here once students check in for today&apos;s
            session.
          </p>
        )}

        {unseated.length > 0 && (
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Not checked in to a seat
            </p>
            <ul className="grid max-h-60 gap-2 overflow-y-auto">
              {unseated.map((a) => (
                <li key={a.enrollmentId} className="flex items-center gap-2.5">
                  <Avatar className="size-7">
                    {a.photoUrl && <AvatarImage src={a.photoUrl} alt={a.name} />}
                    <AvatarFallback className="text-[10px]">
                      {initials(a.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate text-sm">{a.name}</span>
                  {a.isAway ? (
                    <Badge variant="destructive">away</Badge>
                  ) : a.disconnected ? (
                    <Badge variant="outline">disconnected</Badge>
                  ) : a.awayCount > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {a.awayCount}× · {formatAwayDuration(a.awayMs)}
                    </span>
                  ) : (
                    <Badge variant="secondary">focused</Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
