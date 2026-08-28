"use client";

/**
 * The professor's per-student popup, one surface for both routes to it:
 * hovering a seat on the projected map (RoomMap's photo-zoom card) and
 * tapping a seat (a small Dialog — the touch/tablet path, and a deliberate
 * upgrade from tap-releases-immediately, which let one accidental tap erase
 * a student's attendance).
 *
 * It is also where a denial gets settled: the card names what the neighbor
 * reported, and the professor either vouches ("Confirm attendance" — green
 * ring, denial resolved) or agrees with the reporter ("Free this seat").
 * Confirming writes NO seat_verification, so it never counts as anyone
 * having met anyone — attendance integrity, not social credit.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { stablePhotoUrl } from "@/lib/photopin";
import type { SeatRing } from "@/lib/seatrings";

interface Props {
  name: string | null;
  photoUrl: string | null;
  seatLabel: string;
  ring: SeatRing;
  deniedCount: number;
  busy: boolean;
  onConfirm: () => void;
  onFree: () => void;
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

const STATUS: Record<SeatRing, string> = {
  confirmed: "Confirmed present",
  unconfirmed: "Not yet confirmed",
  unconfirmable: "No neighbors to confirm them yet",
  denied: "Reported not in this seat",
};

export function SeatActionCard({
  name,
  photoUrl,
  seatLabel,
  ring,
  deniedCount,
  busy,
  onConfirm,
  onFree,
}: Props) {
  return (
    <div className="flex w-48 flex-col items-center gap-2 p-1 text-center">
      {ring === "denied" && (
        <p className="text-xs font-medium text-destructive">
          {deniedCount > 1
            ? `${deniedCount} neighbors say they're not in this seat.`
            : "A neighbor reported this seat as wrong."}
        </p>
      )}
      <Avatar className="h-24 w-24">
        {photoUrl && (
          <AvatarImage
            src={stablePhotoUrl(photoUrl) ?? photoUrl}
            alt={name ?? ""}
          />
        )}
        <AvatarFallback className="text-2xl">
          {initials(name ?? "?")}
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="text-sm font-medium">{name ?? "A classmate"}</p>
        <p className="text-xs text-muted-foreground">
          Seat {seatLabel} · {STATUS[ring]}
        </p>
      </div>
      <div className="flex w-full flex-col gap-1.5">
        {ring !== "confirmed" && (
          <Button size="sm" disabled={busy} onClick={onConfirm}>
            Confirm attendance
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={onFree}>
          Free this seat
        </Button>
      </div>
    </div>
  );
}
