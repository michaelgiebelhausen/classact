"use client";

/**
 * One classmate, enlarged — the thing a 100px tile can't tell you.
 *
 * A face on a roster grid or a seat map is recognisable at best; this is
 * where it becomes a person you could open a conversation with. It shows
 * exactly what the flash-card reveal already shows a classmate — photo,
 * name, how the name is said, their other photos, and the icebreakers they
 * chose to answer — so nothing becomes newly visible by adding it here.
 *
 * Deliberately NOT shown: LinkedIn (it stays in the flash-card reveal, where
 * students were told it would appear), email (never, anywhere, to a
 * classmate), and anything from the seat-verification system — who has been
 * vouched for is the professor's business, not a fact about a person.
 *
 * All the icebreakers are listed here, unlike the flash cards' two: the
 * cards are a memory game and a third fact would give the answer away, while
 * this is someone deliberately looking a person up.
 */

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { stablePhotoUrl } from "@/lib/photopin";
import { initialsOf } from "@/lib/names";

export interface ClassmateCardData {
  name: string;
  phonetic?: string | null;
  photoUrl: string | null;
  /** Their other photos — a face is easier to learn from more than one. */
  otherPhotoUrls?: string[];
  hints?: Array<{ label: string; value: string }>;
}

export function ClassmateCard({
  name,
  phonetic,
  photoUrl,
  otherPhotoUrls = [],
  hints = [],
}: ClassmateCardData) {
  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <Avatar className="h-28 w-28">
        {photoUrl && (
          <AvatarImage src={stablePhotoUrl(photoUrl) ?? photoUrl} alt={name} />
        )}
        <AvatarFallback className="text-2xl">{initialsOf(name)}</AvatarFallback>
      </Avatar>

      <div>
        <p className="text-lg font-semibold leading-tight">{name}</p>
        {phonetic && (
          <p className="text-sm italic text-muted-foreground">{phonetic}</p>
        )}
      </div>

      {otherPhotoUrls.length > 0 && (
        <div className="flex justify-center gap-2">
          {otherPhotoUrls.slice(0, 2).map((url) => (
            <Avatar key={url} className="size-16 rounded-lg">
              <AvatarImage
                className="rounded-lg"
                src={stablePhotoUrl(url) ?? url}
                alt=""
              />
              <AvatarFallback className="rounded-lg text-xs">
                {initialsOf(name)}
              </AvatarFallback>
            </Avatar>
          ))}
        </div>
      )}

      {hints.length > 0 ? (
        <dl className="grid w-full gap-2 text-left">
          {hints.map((h) => (
            <div key={h.label} className="rounded-lg border px-3 py-2">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {h.label}
              </dt>
              <dd className="text-sm">{h.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">
          They haven&apos;t answered the icebreakers yet.
        </p>
      )}
    </div>
  );
}
