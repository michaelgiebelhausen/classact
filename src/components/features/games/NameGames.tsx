"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { recordGameScore } from "@/server/actions/games";
import { capture } from "@/lib/analytics";
import type { GameType } from "@/types/db";

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
        {tiles.map((tile) => {
          const isUp = flipped.includes(tile.key) || matched.has(tile.playerId);
          const isGone = matched.has(tile.playerId);
          return (
            <button
              key={tile.key}
              type="button"
              onClick={() => tapTile(tile)}
              disabled={isGone}
              aria-label={isUp ? (tile.kind === "name" ? tile.content : "Photo tile") : "Face-down tile"}
              className={[
                "flex aspect-square items-center justify-center overflow-hidden rounded-lg border text-center text-xs font-medium transition-all",
                isGone ? "opacity-25" : "",
                isUp ? "bg-background" : "bg-primary/90",
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
              ) : (
                <span className="text-primary-foreground">?</span>
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

export function NameGames({
  players,
  courseId,
  minPlayers,
}: {
  players: GamePlayer[];
  courseId: string;
  minPlayers: number;
}) {
  const [game, setGame] = useState<GameType>("matching");
  // Per-game round counters: bumping one remounts that game via its key,
  // which deals a fresh board (boards are dealt once per mount).
  const [rounds, setRounds] = useState<Record<GameType, number>>({
    memory_tiles: 0,
    matching: 0,
    flash_cards: 0,
  });
  const nextRound = (g: GameType) =>
    setRounds((r) => ({ ...r, [g]: r[g] + 1 }));

  if (players.length < minPlayers) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Not enough players yet — the games open up once {minPlayers}{" "}
          classmates have added photos. ({players.length} so far.)
        </CardContent>
      </Card>
    );
  }

  return (
    <Tabs value={game} onValueChange={(v) => setGame(v as GameType)}>
      <TabsList>
        <TabsTrigger value="matching">Matching</TabsTrigger>
        <TabsTrigger value="memory_tiles">Memory tiles</TabsTrigger>
        <TabsTrigger value="flash_cards">Flash cards</TabsTrigger>
      </TabsList>
      <TabsContent value="matching">
        <Card>
          <CardContent className="pt-6">
            <Matching
              key={rounds.matching}
              players={players}
              courseId={courseId}
              setNumber={rounds.matching + 1}
              onNextRound={() => nextRound("matching")}
            />
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="memory_tiles">
        <Card>
          <CardContent className="pt-6">
            <MemoryTiles
              key={rounds.memory_tiles}
              players={players}
              courseId={courseId}
              onNextRound={() => nextRound("memory_tiles")}
            />
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="flash_cards">
        <Card>
          <CardContent className="pt-6">
            <FlashCards
              key={rounds.flash_cards}
              players={players}
              courseId={courseId}
              onNextRound={() => nextRound("flash_cards")}
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
