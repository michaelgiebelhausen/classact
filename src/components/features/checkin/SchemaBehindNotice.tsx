import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown in place of the seat map when the database is behind the deployment.
 *
 * The map is the thing this protects. With columns missing, the occupants
 * query returns nothing and the room draws empty — which is not a neutral
 * failure: a student reading an empty map takes a seat someone is already
 * sitting in, and a professor projecting it concludes nobody came. An
 * explicit "this is broken" beats a convincing lie about the room.
 *
 * The professor is told exactly what to run, because they are the one who
 * can run it. Students get the honest shape of the problem without the
 * database internals — they can't act on a migration filename, and it isn't
 * theirs to worry about.
 */
export function SchemaBehindNotice({
  migrations,
  isProfessor,
}: {
  migrations: string[];
  isProfessor: boolean;
}) {
  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardContent className="grid gap-2 py-6">
        <p className="font-medium text-destructive">
          Check-in is unavailable — the site was updated ahead of its database.
        </p>
        {isProfessor ? (
          <>
            <p className="text-sm text-muted-foreground">
              The seat map would show an empty room whether or not anyone has
              checked in, so it&apos;s hidden rather than shown wrong. Run this
              in the Supabase SQL editor and reload — no redeploy needed:
            </p>
            <ul className="grid gap-1 text-sm font-medium">
              {migrations.map((m) => (
                <li key={m}>supabase/migrations/{m}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Attendance already recorded is safe — nothing was lost, and
              check-in works again the moment the migration finishes.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing you did caused this, and your attendance so far is safe.
            Your professor can fix it in about a minute — let them know if they
            haven&apos;t noticed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
