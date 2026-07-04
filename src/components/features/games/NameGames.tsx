"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { recordGameScore } from "@/server/actions/games";
import { capture } from "@/lib/analytics";
import type { GameType } from "@/types/db";

export interface GamePlayer {
  enrollmentId: string;
  name: string;
  photoUrls: string[]; // 1–3 signed URLs
  /** Pronunciation guide ("shiv-AWN"), if the classmate added one. */
  phonetic?: string | null;
  /** One icebreaker fact for the flash-card back, e.g. { label: "Hometown", value: "Greenville, SC" }. */
  hint?: { label: string; value: string } | null;
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
  onExit,
}: {
  players: GamePlayer[];
  courseId: string;
  onExit: () => void;
}) {
  const boardPlayers = useMemo(
    () => shuffle(players).slice(0, Math.min(8, players.length)),
    [players]
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
          content: p.photoUrls[Math.floor(Math.random() * p.photoUrls.length)],
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
        onExit={onExit}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Match each face to the right name. {moves} flips so far.
      </p>
      <div className="grid grid-cols-4 gap-2">
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
  onExit,
}: {
  players: GamePlayer[];
  courseId: string;
  onExit: () => void;
}) {
  const deck = useMemo(() => shuffle(players), [players]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [right, setRight] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [done, setDone] = useState(false);

  const player = deck[index];
  // Deterministic per card (cycles the 1–3 photo kinds across the deck).
  const photo = player
    ? player.photoUrls[index % player.photoUrls.length]
    : null;

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
        onExit={onExit}
      />
    );
  }
  if (!player || !photo) return null;

  return (
    <div className="grid justify-items-center gap-4">
      <p className="text-sm text-muted-foreground">
        Card {index + 1} of {deck.length} — know their name before you flip.
      </p>
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="w-64 overflow-hidden rounded-xl border shadow-sm"
        aria-label={revealed ? player.name : "Flip to reveal name"}
      >
        {revealed ? (
          <div className="flex h-72 flex-col items-center justify-center gap-2 bg-background p-4 text-center">
            <span className="text-xl font-semibold">{player.name}</span>
            {player.phonetic ? (
              <span className="text-sm italic text-muted-foreground">
                {player.phonetic}
              </span>
            ) : null}
            {player.hint ? (
              <span className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium">{player.hint.label}:</span>{" "}
                {player.hint.value}
              </span>
            ) : null}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="Classmate" className="h-72 w-64 object-cover" />
        )}
      </button>
      {revealed ? (
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => next(false)}>
            Didn&apos;t know it
          </Button>
          <Button onClick={() => next(true)}>Got it</Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setRevealed(true)}>
          Flip
        </Button>
      )}
    </div>
  );
}

/* ---------------- Matching (tap to pair) ---------------- */

function Matching({
  players,
  courseId,
  onExit,
}: {
  players: GamePlayer[];
  courseId: string;
  onExit: () => void;
}) {
  // A board of up to 6. Photos hold their order; the name column is shuffled.
  const boardPlayers = useMemo(
    () => shuffle(players).slice(0, Math.min(6, players.length)),
    [players]
  );
  const nameColumn = useMemo(() => shuffle(boardPlayers), [boardPlayers]);

  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [wrongName, setWrongName] = useState<string | null>(null);
  const [misses, setMisses] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [done, setDone] = useState(false);

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

  function pickName(id: string) {
    if (done || matched.has(id) || !selectedPhoto) return;
    if (selectedPhoto === id) {
      const next = new Set(matched);
      next.add(id);
      setMatched(next);
      setSelectedPhoto(null);
      setWrongName(null);
      if (next.size === boardPlayers.length) setDone(true);
    } else {
      setMisses((m) => m + 1);
      setWrongName(id);
      setSelectedPhoto(null);
    }
  }

  if (done) {
    return (
      <GameResult
        title="All matched."
        detail={
          misses === 0
            ? "Perfect — no misses."
            : `${misses} miss${misses === 1 ? "" : "es"} along the way.`
        }
        onExit={onExit}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Tap a face, then tap the name that goes with it.{" "}
        {misses > 0 ? `${misses} miss${misses === 1 ? "" : "es"}.` : null}
      </p>
      <div className="grid grid-cols-2 gap-4">
        {/* Photo column */}
        <div className="grid gap-2">
          {boardPlayers.map((p) => {
            const isMatched = matched.has(p.enrollmentId);
            const isSelected = selectedPhoto === p.enrollmentId;
            return (
              <button
                key={p.enrollmentId}
                type="button"
                onClick={() => {
                  if (!isMatched) setSelectedPhoto(p.enrollmentId);
                }}
                disabled={isMatched}
                aria-label={isMatched ? `Matched: ${p.name}` : "Pick this face"}
                className={[
                  "overflow-hidden rounded-lg border-2 transition-all",
                  isMatched ? "opacity-30" : "",
                  isSelected ? "border-primary ring-2 ring-primary" : "border-transparent",
                ].join(" ")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.photoUrls[0]}
                  alt="Classmate"
                  className="aspect-square w-full object-cover"
                />
              </button>
            );
          })}
        </div>
        {/* Name column */}
        <div className="grid content-start gap-2">
          {nameColumn.map((p) => {
            const isMatched = matched.has(p.enrollmentId);
            const isWrong = wrongName === p.enrollmentId;
            return (
              <button
                key={p.enrollmentId}
                type="button"
                onClick={() => pickName(p.enrollmentId)}
                disabled={isMatched}
                className={[
                  "rounded-lg border px-3 py-2 text-left text-sm font-medium transition-all",
                  isMatched ? "border-primary bg-primary/10 text-primary opacity-60" : "",
                  isWrong ? "border-destructive bg-destructive/10 text-destructive" : "",
                  !isMatched && !isWrong ? "hover:border-primary" : "",
                ].join(" ")}
              >
                {p.name}
                {p.phonetic ? (
                  <span className="block text-xs font-normal italic text-muted-foreground">
                    {p.phonetic}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Shared ---------------- */

function GameResult({
  title,
  detail,
  onExit,
}: {
  title: string;
  detail: string;
  onExit: () => void;
}) {
  return (
    <div className="grid justify-items-center gap-3 py-8 text-center">
      <p className="text-xl font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <Button onClick={onExit}>Play again</Button>
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
  const [game, setGame] = useState<GameType | null>(null);

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

  if (!game) {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="cursor-pointer" onClick={() => setGame("memory_tiles")}>
          <CardHeader>
            <CardTitle>Memory tiles</CardTitle>
            <CardDescription>
              Flip tiles to match faces with names. Clear the board.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button>Play</Button>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setGame("matching")}>
          <CardHeader>
            <CardTitle>Matching</CardTitle>
            <CardDescription>
              Tap a face, then tap the name that goes with it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button>Play</Button>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setGame("flash_cards")}>
          <CardHeader>
            <CardTitle>Flash cards</CardTitle>
            <CardDescription>
              See the face, guess the name, flip to check yourself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button>Play</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        {game === "memory_tiles" ? (
          <MemoryTiles
            players={players}
            courseId={courseId}
            onExit={() => setGame(null)}
          />
        ) : game === "matching" ? (
          <Matching
            players={players}
            courseId={courseId}
            onExit={() => setGame(null)}
          />
        ) : (
          <FlashCards
            players={players}
            courseId={courseId}
            onExit={() => setGame(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
