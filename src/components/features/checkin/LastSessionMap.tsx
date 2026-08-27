import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RoomMap } from "@/components/features/rooms/RoomMap";
import type { RoomMapSeat } from "@/components/features/rooms/RoomMap";

export interface LastSessionOccupant {
  seatId: string;
  name: string | null;
  photoUrl: string | null;
}

/**
 * The most recent class, seated exactly as it ended.
 *
 * Sits under the live map, and earns its place twice over. It is the answer to
 * "who sat where last time" without digging through history — and it is bulky
 * enough to push the absence list below the fold, so a projected screen shows
 * two seating charts rather than one student's private business.
 *
 * Rendered flat and small on purpose: no perspective, no fit, no taps. This is
 * a reference, not the thing being projected, and making it look like the live
 * map would invite someone to try to correct a seat in it.
 */
export function LastSessionMap({
  seats,
  occupants,
  date,
}: {
  seats: RoomMapSeat[];
  occupants: LastSessionOccupant[];
  date: string;
}) {
  const bySeat = new Map(occupants.map((o) => [o.seatId, o]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Last class</CardTitle>
        <CardDescription>
          {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}{" "}
          · {occupants.length}{" "}
          {occupants.length === 1 ? "student" : "students"} checked in
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <RoomMap
            seats={seats}
            ariaLabel={`Seat map for the class on ${date}`}
            captions
            flipped
            podium
            frontLabel="Front of room"
            stateFor={(seat) => {
              const who = bySeat.get(seat.id);
              return {
                kind: who ? "taken" : "empty",
                name: who?.name ?? null,
                photoUrl: who?.photoUrl ?? null,
                caption: who?.name?.split(/\s+/)[0] ?? undefined,
                tappable: false,
              };
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
