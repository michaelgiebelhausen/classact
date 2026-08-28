"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Shuffle, Type, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { recordGameScore } from "@/server/actions/games";
import { capture } from "@/lib/analytics";
import { initialsOf, sortByLastName } from "@/lib/names";
import {
  ClassmateCard,
  type ClassmateCardData,
} from "@/components/features/games/ClassmateCard";
import {
  LastSessionMap,
  type LastSessionOccupant,
} from "@/components/features/checkin/LastSessionMap";
import type { RoomMapSeat } from "@/components/features/rooms/RoomMap";
import type { GameType, PhotoKind } from "@/types/db";

export interface GamePlayer {
  enrollmentId: string;
  name: string;
  photoUrls: string[]; // 1–3 signed URLs
  /** Pronunciation guide ("shiv-AWN"), if the classmate added one. */
  phonetic?: string | null;
  /** Every icebreaker they answered, e.g. [{ label: "Hometown", value: "Greenville, SC" }]. */
  hints: Array<{ label: string; value: string }>;
  /** Canonical LinkedIn profile, when they've added one. */
  linkedinUrl?: string | null;
}

/**
 * A different photo each time someone comes up: with three uploads, each
 * shows about a third of the time. Called from deal-time state initializers
 * so a re-render never swaps the face mid-round.
 */
function pickPhoto(p: GamePlayer): string {
  return p.photoUrls[Math.floor(Math.random() * p.photoUrls.length)];
}

/** "Emma Mabel Roethke" → "Emma" — the name-tag label on a matched face. */
function firstNameOf(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- Memory tiles (FR-013) ---------------- */

interface Tile {
  key: string;
  playerId: string;
  kind: "photo" | "name";
  content: string; // url or name
}

function MemoryTiles({
  players,
  courseId,
  onNextRound,
}: {
  players: GamePlayer[];
  courseId: string;
  onNextRound: () => void;
}) {
  // Deal once per game: useState initializers run exactly once per mount,
  // so RSC refetches (which hand us a new players array identity) can't
  // reshuffle the board mid-game.
  const [boardPlayers] = useState(() =>
    shuffle(players).slice(0, Math.min(9, players.length))
  );
  const byId = useMemo(
    () => new Map(boardPlayers.map((p) => [p.enrollmentId, p])),
    [boardPlayers]
  );
  const [tiles] = useState<Tile[]>(() =>
    shuffle(
      boardPlayers.flatMap((p) => [
        {
          key: `${p.enrollmentId}-photo`,
          playerId: p.enrollmentId,
          kind: "photo" as const,
          content: pickPhoto(p),
        },
        {
          key: `${p.enrollmentId}-name`,
          playerId: p.enrollmentId,
          kind: "name" as const,
          content: p.name,
        },
      ])
    )
  );
  const [flipped, setFlipped] = useState<string[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (flipped.length !== 2) return;
    const [a, b] = flipped.map((k) => tiles.find((t) => t.key === k)!);
    const isMatch = a.playerId === b.playerId && a.kind !== b.kind;
    const timer = setTimeout(() => {
      if (isMatch) {
        const next = new Set(matched);
        next.add(a.playerId);
        setMatched(next);
        if (next.size === boardPlayers.length) {
          // Board cleared — score: fewer moves = better.
          setDone(true);
          capture("game_played", { gameType: "memory_tiles" });
          recordGameScore({
            courseId,
            gameType: "memory_tiles" satisfies GameType,
            score: Math.max(0, 100 - (moves - boardPlayers.length) * 5),
            durationMs: Date.now() - startedAt,
          }).then((r) => {
            if (!r.ok) toast.error(r.error);
          });
        }
      }
      setFlipped([]);
    }, isMatch ? 350 : 900);
    return () => clearTimeout(timer);
  }, [flipped, tiles, matched, boardPlayers.length, moves, startedAt, courseId]);

  function tapTile(tile: Tile) {
    if (done || flipped.length === 2) return;
    if (matched.has(tile.playerId) || flipped.includes(tile.key)) return;
    setFlipped((f) => [...f, tile.key]);
    if (flipped.length === 1) setMoves((m) => m + 1);
  }

  if (done) {
    return (
      <GameResult
        title="Board cleared."
        detail={`${moves} flips for ${boardPlayers.length} classmates.`}
        onPlayAgain={onNextRound}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Match each face to the right name. {moves} flips so far.
      </p>
      {/* Six across on a laptop: 9 pairs = three full rows, not a slog. */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map((tile, i) => {
          const isUp = flipped.includes(tile.key) || matched.has(tile.playerId);
          const isGone = matched.has(tile.playerId);
          // Six across on a laptop; the grid narrows on small screens, but a
          // stable row/column still beats "one of nine identical tiles" for
          // anyone navigating by screen reader.
          const where = `row ${Math.floor(i / 6) + 1}, column ${(i % 6) + 1}`;
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => tapTile(tile)}
              disabled={isGone}
              aria-label={
                isUp
                  ? tile.kind === "name"
                    ? `${tile.content}, ${where}`
                    : `Photo tile, ${where}`
                  : tile.kind === "name"
                    ? `Face-down name tile, ${where}`
                    : `Face-down photo tile, ${where}`
              }
              className={[
                "flex aspect-square items-center justify-center overflow-hidden rounded-lg border text-center text-xs font-medium transition-all",
                // Matched pairs stay legible: this is the moment the game
                // has to land the name on the face, so don't wash it out.
                isGone ? "opacity-60" : "",
                // Face down, the back says which half of the pair it is —
                // you hunt a name for a face, not through twice as many
                // unknowns. Photos stay the familiar orange; the blue is
                // the palette's own --sky, which holds in both themes.
                isUp
                  ? "bg-background"
                  : tile.kind === "name"
                    ? "bg-[var(--sky)]"
                    : "bg-primary/90",
              ].join(" ")}
            >
              {isUp ? (
                tile.kind === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tile.content}
                    alt="Classmate"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="grid gap-0.5 p-1 leading-tight">
                    {tile.content}
                    {byId.get(tile.playerId)?.phonetic ? (
                      <span className="text-[10px] font-normal italic text-muted-foreground">
                        {byId.get(tile.playerId)!.phonetic}
                      </span>
                    ) : null}
                  </span>
                )
              ) : // A glyph as well as a colour, so the shortcut still works
              // for the colour-blind students in the room.
              tile.kind === "name" ? (
                <Type className="size-5 text-white" aria-hidden />
              ) : (
                <User className="size-5 text-primary-foreground" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Flash cards (FR-014) ---------------- */

function FlashCards({
  players,
  courseId,
  onNextRound,
}: {
  players: GamePlayer[];
  courseId: string;
  onNextRound: () => void;
}) {
  // Deal once per game (see MemoryTiles) — a reshuffle mid-run swapped the
  // face under the card whenever the server payload refreshed. Each card
  // also fixes its photo and which slice of the person's bio it shows, so
  // running the deck again surfaces different shots and different facts.
  const [deck] = useState(() =>
    shuffle(players).map((p) => ({
      ...p,
      photo: pickPhoto(p),
      shownHints: shuffle(p.hints).slice(0, 2),
    }))
  );
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [right, setRight] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [done, setDone] = useState(false);

  const player = deck[index];

  function next(gotIt: boolean) {
    const newRight = gotIt ? right + 1 : right;
    setRight(newRight);
    setRevealed(false);
    if (index + 1 >= deck.length) {
      setDone(true);
      capture("game_played", { gameType: "flash_cards" });
      recordGameScore({
        courseId,
        gameType: "flash_cards" satisfies GameType,
        score: Math.round((newRight / deck.length) * 100),
        durationMs: Date.now() - startedAt,
      }).then((r) => {
        if (!r.ok) toast.error(r.error);
      });
    } else {
      setIndex((i) => i + 1);
    }
  }

  if (done) {
    return (
      <GameResult
        title={`${right}/${deck.length} names right.`}
        detail={right === deck.length ? "You know the whole room." : "Run it again — it sticks fast."}
        onPlayAgain={onNextRound}
      />
    );
  }
  if (!player) return null;
  // Their other uploads — a second look at the same person on the reveal.
  const otherPhotos = player.photoUrls
    .filter((url) => url !== player.photo)
    .slice(0, 2);

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Card {index + 1} of {deck.length} — know their name before you flip.
      </p>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,18rem)_1fr]">
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="overflow-hidden rounded-xl border shadow-sm"
          aria-label={revealed ? player.name : "Flip to reveal name"}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={player.photo}
            alt="Classmate"
            className="aspect-[4/5] w-full object-cover"
          />
        </button>

        <div className="grid content-start gap-3">
          {revealed ? (
            <>
              <div>
                <p className="text-2xl font-semibold leading-tight">
                  {player.name}
                </p>
                {player.phonetic ? (
                  <p className="text-sm italic text-muted-foreground">
                    {player.phonetic}
                  </p>
                ) : null}
                {player.linkedinUrl ? (
                  <a
                    href={player.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex w-fit items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    <ExternalLink className="size-4" /> Connect on LinkedIn
                  </a>
                ) : null}
              </div>

              {otherPhotos.length > 0 && (
                <div className="flex gap-2">
                  {otherPhotos.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      src={url}
                      alt=""
                      className="size-20 rounded-lg border object-cover"
                    />
                  ))}
                </div>
              )}

              {player.shownHints.length > 0 ? (
                <dl className="grid gap-2">
                  {player.shownHints.map((h) => (
                    <div key={h.label} className="rounded-lg border p-3">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {h.label}
                      </dt>
                      <dd className="mt-0.5 text-sm">{h.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  They haven&apos;t answered the icebreakers yet.
                </p>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => next(false)}>
                  Didn&apos;t know it
                </Button>
                <Button onClick={() => next(true)}>Got it</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Say their name out loud, then flip to see if you had it — and
                pick up something about them while you&apos;re here.
              </p>
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => setRevealed(true)}
              >
                Flip
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Matching (tap to pair) ---------------- */

function Matching({
  players,
  courseId,
  setNumber,
  onNextRound,
}: {
  players: GamePlayer[];
  courseId: string;
  /** 1-based count of sets played this visit — the scoreboard label. */
  setNumber: number;
  onNextRound: () => void;
}) {
  // A board of up to 6, dealt once per game (see MemoryTiles). Photos hold
  // their order; the name column is shuffled.
  const [boardPlayers] = useState(() =>
    shuffle(players).slice(0, Math.min(6, players.length))
  );
  const [nameColumn] = useState(() => shuffle(boardPlayers));
  // One photo per face per deal, so repeat rounds don't always show the
  // same shot of the same person.
  const [photoById] = useState(
    () => new Map(boardPlayers.map((p) => [p.enrollmentId, pickPhoto(p)]))
  );

  // Name-tag flow: pick a name, then drop it on the right face (tap or drag).
  const [heldName, setHeldName] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [wrongPhoto, setWrongPhoto] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [done, setDone] = useState(false);

  // Clear the "wrong face" flash on its own.
  useEffect(() => {
    if (!wrongPhoto) return;
    const timer = setTimeout(() => setWrongPhoto(null), 700);
    return () => clearTimeout(timer);
  }, [wrongPhoto]);

  // Record the finished round in an effect (keeps Date.now() out of render,
  // same as Memory tiles). Fires once when the board is cleared.
  useEffect(() => {
    if (!done) return;
    capture("game_played", { gameType: "matching" });
    recordGameScore({
      courseId,
      gameType: "matching" satisfies GameType,
      score: Math.max(0, 100 - misses * 10),
      durationMs: Date.now() - startedAt,
    }).then((r) => {
      if (!r.ok) toast.error(r.error);
    });
    // misses/startedAt are read once at completion; done is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // Linger on the fully-tagged board for a beat, then deal the next set —
  // the point is repetition, not a results screen.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(onNextRound, 1800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  /** Drop the held name tag on a face. */
  function placeOn(photoId: string) {
    if (done || matched.has(photoId) || !heldName) return;
    if (heldName === photoId) {
      const next = new Set(matched);
      next.add(photoId);
      setMatched(next);
      setHeldName(null);
      setWrongPhoto(null);
      if (next.size === boardPlayers.length) setDone(true);
    } else {
      setMisses((m) => m + 1);
      setWrongPhoto(photoId);
      setHeldName(null);
    }
  }

  // Fill the width with as square a grid as the board allows; the grid
  // stretches to the name column's height so faces get the whole space.
  const cols = boardPlayers.length <= 4 ? 2 : 3;
  const rows = Math.ceil(boardPlayers.length / cols);

  return (
    <div className="grid gap-3">
      {done ? (
        <p className="text-sm font-medium">
          All matched{misses === 0 ? " — perfect!" : "."} Dealing the next
          set…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {heldName
            ? "Now tap the person it belongs to."
            : "Tap a name, then tap whose it is — or drag it onto their photo."}
        </p>
      )}
      <div className="flex flex-wrap items-stretch gap-4">
        {/* Faces — the drop targets for name tags. */}
        <div
          className="grid min-h-80 min-w-64 flex-1 gap-2"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {boardPlayers.map((p) => {
            const isMatched = matched.has(p.enrollmentId);
            const isWrong = wrongPhoto === p.enrollmentId;
            return (
              <button
                key={p.enrollmentId}
                type="button"
                onClick={() => placeOn(p.enrollmentId)}
                onDragOver={(e) => {
                  if (heldName && !isMatched) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  placeOn(p.enrollmentId);
                }}
                disabled={isMatched}
                aria-label={
                  isMatched
                    ? `Matched: ${p.name}`
                    : heldName
                      ? "Put the name here"
                      : "Pick a name first"
                }
                className={[
                  "relative min-h-0 overflow-hidden rounded-lg border-2 transition-all",
                  isMatched ? "border-primary" : "",
                  isWrong ? "border-destructive ring-2 ring-destructive" : "",
                  !isMatched && !isWrong
                    ? heldName
                      ? "cursor-copy border-dashed border-primary/40 hover:border-primary"
                      : "border-transparent"
                    : "",
                ].join(" ")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoById.get(p.enrollmentId)}
                  alt="Classmate"
                  className="h-full w-full object-cover"
                />
                {isMatched && (
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-center text-sm font-semibold text-white">
                    {firstNameOf(p.name)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Name tags */}
        <div className="grid w-full shrink-0 content-start gap-2 sm:w-64">
          <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2">
            <span className="text-xs text-muted-foreground">Set {setNumber}</span>
            <span
              className={[
                "text-sm font-semibold tabular-nums",
                misses > 0 ? "text-destructive" : "text-muted-foreground",
              ].join(" ")}
            >
              {misses} {misses === 1 ? "miss" : "misses"}
            </span>
          </div>
          {nameColumn.map((p) => {
            const isMatched = matched.has(p.enrollmentId);
            const isHeld = heldName === p.enrollmentId;
            return (
              <button
                key={p.enrollmentId}
                type="button"
                draggable={!isMatched}
                onDragStart={() => setHeldName(p.enrollmentId)}
                onClick={() => {
                  if (!isMatched) setHeldName(isHeld ? null : p.enrollmentId);
                }}
                disabled={isMatched}
                aria-pressed={isHeld}
                className={[
                  "rounded-lg border px-3 py-2 text-left text-sm font-medium transition-all",
                  isMatched
                    ? "border-dashed border-primary/30 bg-transparent text-muted-foreground/40"
                    : isHeld
                      ? "border-primary bg-primary text-primary-foreground shadow-md"
                      : "cursor-grab hover:border-primary",
                ].join(" ")}
              >
                {p.name}
                {p.phonetic ? (
                  <span
                    className={[
                      "block text-xs font-normal italic",
                      isHeld ? "text-primary-foreground/80" : "text-muted-foreground",
                    ].join(" ")}
                  >
                    {p.phonetic}
                  </span>
                ) : null}
              </button>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={onNextRound}
            disabled={done}
          >
            <Shuffle className="mr-2 size-4" /> Reshuffle
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Shared ---------------- */

function GameResult({
  title,
  detail,
  onPlayAgain,
}: {
  title: string;
  detail: string;
  onPlayAgain: () => void;
}) {
  return (
    <div className="grid justify-items-center gap-3 py-8 text-center">
      <p className="text-xl font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <Button onClick={onPlayAgain}>Play again</Button>
    </div>
  );
}

/** Everyone on the roster — unlike GamePlayer, a photo is optional. */
export interface RosterPerson {
  enrollmentId: string;
  name: string;
  photoUrl: string | null;
  /** Their own uploads, still labelled, so the grid can show one kind. */
  photosByKind?: Partial<Record<PhotoKind, string>>;
  /** The seeded (Canvas) photo, used when they've uploaded nothing. */
  rosterPhotoUrl?: string | null;
  phonetic?: string | null;
  hints?: Array<{ label: string; value: string }>;
}

/**
 * Which face the roster shows.
 *
 * Students are asked for three photos because people don't always look like
 * their campus ID picture — a classmate you'd recognise from a night out is
 * a stranger in a headshot, and the other way round. "Any" is the everyday
 * view; the three kinds are for studying one particular look, and each shows
 * a coverage count so the tabs double as a read on who still owes a photo.
 */
const PHOTO_VIEWS = [
  { key: "any", label: "Any" },
  { key: "candid", label: "Selfie" },
  { key: "professional", label: "Headshot" },
  { key: "adventure", label: "Adventure" },
] as const;
type PhotoView = (typeof PHOTO_VIEWS)[number]["key"];

/** The photo to draw for one person under the current view. */
function photoFor(p: RosterPerson, view: PhotoView): string | null {
  if (view === "any") return p.photoUrl;
  // A kind that person hasn't uploaded shows as initials rather than
  // borrowing a different photo — otherwise "everyone's headshot" quietly
  // becomes "everyone's something", and the coverage count would lie.
  return p.photosByKind?.[view] ?? null;
}

/**
 * The class list, not a game: every face and name at once, filed by last
 * name. Somewhere to look someone up (or study) without being quizzed.
 * Classmates without a photo still appear, as initials — a roster with
 * people missing from it isn't a roster.
 */
function Roster({
  people,
  available,
  onOpen,
}: {
  people: RosterPerson[];
  available: boolean;
  onOpen: (person: RosterPerson) => void;
}) {
  // Unlike the games, a reference sheet shouldn't reshuffle or swap faces
  // under you — sorted once, same photo every time.
  const sorted = useMemo(() => sortByLastName(people, (p) => p.name), [people]);
  // A signed photo URL expires after an hour; on the one tab meant to be
  // left open, a stale URL should fall back to initials rather than paint
  // a grid of broken-image icons.
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [view, setView] = useState<PhotoView>("any");

  if (!available) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        The roster can&apos;t be loaded — this server is missing its
        Supabase service role key. (Your class isn&apos;t empty.)
      </p>
    );
  }

  if (sorted.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        Nobody on the roster yet — classmates appear here as they join.
      </p>
    );
  }

  const withPhotos = sorted.filter((p) => p.photoUrl).length;
  const shownCount = sorted.filter((p) => photoFor(p, view)).length;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {sorted.length} {sorted.length === 1 ? "person" : "people"}, by last
          name
          {withPhotos < sorted.length
            ? ` · ${sorted.length - withPhotos} without a photo yet`
            : ""}
          .
        </p>
        <div className="flex flex-wrap gap-1">
          {PHOTO_VIEWS.map((v) => {
            const count =
              v.key === "any"
                ? withPhotos
                : sorted.filter((p) => p.photosByKind?.[v.key]).length;
            return (
              <Button
                key={v.key}
                type="button"
                size="sm"
                variant={view === v.key ? "default" : "outline"}
                className="h-7 px-2 text-xs"
                onClick={() => setView(v.key)}
              >
                {v.label}{" "}
                <span
                  className={
                    view === v.key
                      ? "opacity-80"
                      : "text-muted-foreground"
                  }
                >
                  {count}/{sorted.length}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
      {view !== "any" && shownCount < sorted.length && (
        <p className="text-xs text-muted-foreground">
          {sorted.length - shownCount} haven&apos;t added
          {view === "candid"
            ? " a selfie"
            : view === "professional"
              ? " a headshot"
              : " an adventure photo"}{" "}
          — they show as initials rather than borrowing another photo.
        </p>
      )}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {sorted.map((p) => {
          const url = photoFor(p, view);
          return (
            <li key={p.enrollmentId}>
              <button
                type="button"
                onClick={() => onOpen(p)}
                aria-label={`View ${p.name}`}
                className="grid w-full justify-items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {url && !broken.has(p.enrollmentId + view) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={p.name}
                    onError={() =>
                      setBroken((b) => new Set(b).add(p.enrollmentId + view))
                    }
                    className="aspect-square w-full rounded-lg object-cover transition-opacity hover:opacity-90"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="grid aspect-square w-full place-items-center rounded-lg border border-dashed bg-muted text-xl font-semibold text-muted-foreground"
                  >
                    {initialsOf(p.name)}
                  </div>
                )}
                <div className="text-center">
                  <p className="text-sm font-medium leading-tight">{p.name}</p>
                  {p.phonetic && (
                    <p className="text-xs text-muted-foreground">
                      {p.phonetic}
                    </p>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NameGames({
  players,
  roster,
  rosterAvailable,
  courseId,
  minPlayers,
  seats = [],
  lastSession = null,
}: {
  players: GamePlayer[];
  roster: RosterPerson[];
  rosterAvailable: boolean;
  courseId: string;
  minPlayers: number;
  seats?: RoomMapSeat[];
  lastSession?: {
    date: string;
    occupants: LastSessionOccupant[];
  } | null;
}) {
  const [game, setGame] = useState<GameType | "roster" | "last_class">(
    "matching"
  );
  /**
   * The map opens in the professor's orientation — front of the room at the
   * bottom — because that is how the class saw it projected, and a student
   * matching this map against their memory of the room is matching against
   * that image. The button turns it around for anyone who'd rather read it
   * from their own seat.
   */
  const [mapFlipped, setMapFlipped] = useState(true);
  /** The classmate whose card is open, by enrollment id. */
  const [openId, setOpenId] = useState<string | null>(null);

  // Roster rows carry name/phonetic/hints for everyone; player rows carry the
  // extra photos. Merging by enrollment id means a card shows everything the
  // page already knows about a person, whether they were opened from the
  // grid or from a seat.
  const cardFor = useMemo(() => {
    const byId = new Map<string, ClassmateCardData>();
    for (const p of roster) {
      byId.set(p.enrollmentId, {
        name: p.name,
        phonetic: p.phonetic,
        photoUrl: p.photoUrl,
        hints: p.hints ?? [],
      });
    }
    for (const p of players) {
      const existing = byId.get(p.enrollmentId);
      const primary = existing?.photoUrl ?? p.photoUrls[0] ?? null;
      byId.set(p.enrollmentId, {
        name: existing?.name ?? p.name,
        phonetic: existing?.phonetic ?? p.phonetic,
        photoUrl: primary,
        otherPhotoUrls: p.photoUrls.filter((u) => u !== primary),
        hints: existing?.hints?.length ? existing.hints : p.hints,
      });
    }
    return byId;
  }, [roster, players]);

  const openCard = openId ? cardFor.get(openId) ?? null : null;
  // Per-game round counters: bumping one remounts that game via its key,
  // which deals a fresh board (boards are dealt once per mount).
  const [rounds, setRounds] = useState<Record<GameType, number>>({
    memory_tiles: 0,
    matching: 0,
    flash_cards: 0,
  });
  const nextRound = (g: GameType) =>
    setRounds((r) => ({ ...r, [g]: r[g] + 1 }));

  // The games need a crowd, but the roster is useful from the first photo —
  // so the gate lives inside the game tabs instead of in front of everything.
  const enoughPlayers = players.length >= minPlayers;
  const notEnoughYet = (
    <p className="py-12 text-center text-muted-foreground">
      Not enough players yet — the games open up once {minPlayers} classmates
      have added photos. ({players.length} so far.)
    </p>
  );

  return (
    <Tabs
      value={game}
      onValueChange={(v) => setGame(v as GameType | "roster" | "last_class")}
    >
      <TabsList>
        <TabsTrigger value="matching">Matching</TabsTrigger>
        <TabsTrigger value="memory_tiles">Memory tiles</TabsTrigger>
        <TabsTrigger value="flash_cards">Flash cards</TabsTrigger>
        <TabsTrigger value="roster">Roster</TabsTrigger>
        <TabsTrigger value="last_class">Last class</TabsTrigger>
      </TabsList>
      <TabsContent value="matching">
        <Card>
          <CardContent className="pt-6">
            {enoughPlayers ? (
              <Matching
                key={rounds.matching}
                players={players}
                courseId={courseId}
                setNumber={rounds.matching + 1}
                onNextRound={() => nextRound("matching")}
              />
            ) : (
              notEnoughYet
            )}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="memory_tiles">
        <Card>
          <CardContent className="pt-6">
            {enoughPlayers ? (
              <MemoryTiles
                key={rounds.memory_tiles}
                players={players}
                courseId={courseId}
                onNextRound={() => nextRound("memory_tiles")}
              />
            ) : (
              notEnoughYet
            )}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="flash_cards">
        <Card>
          <CardContent className="pt-6">
            {enoughPlayers ? (
              <FlashCards
                key={rounds.flash_cards}
                players={players}
                courseId={courseId}
                onNextRound={() => nextRound("flash_cards")}
              />
            ) : (
              notEnoughYet
            )}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="roster">
        <Card>
          <CardContent className="pt-6">
            <Roster
              people={roster}
              available={rosterAvailable}
              onOpen={(p) => setOpenId(p.enrollmentId)}
            />
          </CardContent>
        </Card>
      </TabsContent>
      {/* Where everyone sat last time — the seating chart is a memory aid in
          its own right, because "the guy who sits behind me" is how people
          actually index their classmates. */}
      <TabsContent value="last_class">
        {lastSession && seats.length > 0 ? (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
              <span>
                The{" "}
                <span className="font-medium text-foreground">
                  front of the room
                </span>{" "}
                is at the {mapFlipped ? "bottom" : "top"} of this map.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setMapFlipped((v) => !v)}
              >
                Turn the map around
              </Button>
            </div>
            <LastSessionMap
              seats={seats}
              occupants={lastSession.occupants}
              date={lastSession.date}
              flipped={mapFlipped}
              frontLabel={
                mapFlipped ? "Front of room" : "Front of room (behind you)"
              }
              tappable
              onSeatTap={(seat) => {
                const who = lastSession.occupants.find(
                  (o) => o.seatId === seat.id
                );
                if (who?.enrollmentId) setOpenId(who.enrollmentId);
              }}
            />
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No class has met yet — once everyone checks in, the seating
              chart shows up here.
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <Dialog
        open={openId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        <DialogContent className="max-w-xs">
          {openCard && (
            <>
              <DialogTitle className="sr-only">{openCard.name}</DialogTitle>
              <ClassmateCard {...openCard} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
