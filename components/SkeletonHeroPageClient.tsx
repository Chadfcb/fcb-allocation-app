"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SkeletonHeroGame, type GameStatus } from "@/lib/skeletonHero/game";

// Where the rigged/animated character model is served from — must live
// under public/ (not the repo-root game-assets/ folder, which Next.js
// doesn't serve) so the browser can fetch it as a plain static file. See
// claude/ernie-skeleton-hero-rigging-status.md for how this .glb was built
// and verified.
const CHARACTER_GLB_URL = "/game-assets/ernie-skeleton-hero-character.glb";

const LEADERBOARD_SIZE = 10;

interface LeaderboardRow {
  display_name: string;
  score: number;
  created_at: string;
}

export default function SkeletonHeroPageClient({ displayName }: { displayName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<SkeletonHeroGame | null>(null);
  const [supabase] = useState(() => createClient());

  const [status, setStatus] = useState<GameStatus>("loading");
  const [score, setScore] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null);
  const [scoreSaved, setScoreSaved] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const game = new SkeletonHeroGame(canvas, {
      onStatusChange: setStatus,
      onScoreChange: setScore,
      onError: setErrorMessage,
    });
    gameRef.current = game;
    game.init(CHARACTER_GLB_URL);

    return () => {
      game.dispose();
      gameRef.current = null;
    };
    // Intentionally empty — this sets up the game exactly once per mount;
    // it does not react to score/status changes (those flow the other way,
    // from the game's callbacks into this component's state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On level complete: save this run's score once, then load the top scores.
  useEffect(() => {
    if (status !== "complete") return;
    let cancelled = false;

    (async () => {
      if (!scoreSaved) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("skeleton_hero_scores").insert({
            user_id: user.id,
            display_name: displayName,
            score,
          });
        }
        if (!cancelled) setScoreSaved(true);
      }

      const { data } = await supabase
        .from("skeleton_hero_scores")
        .select("display_name, score, created_at")
        .order("score", { ascending: false })
        .limit(LEADERBOARD_SIZE);
      if (!cancelled) setLeaderboard((data as LeaderboardRow[] | null) ?? []);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function handlePlayAgain() {
    window.location.reload();
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Skeleton Hero</h1>
          <p className="text-xs text-neutral-500">
            A/D or arrow keys to move, Space to jump, click to shoot. Look up (move the mouse toward
            the top of the screen) to aim up.
          </p>
        </div>
        <div className="rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-200">
          Score: <span className="font-semibold text-[#6ABC46]">{score}</span>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden rounded border border-neutral-800 bg-black">
        <canvas ref={canvasRef} className="block h-full w-full" />

        {status === "loading" && (
          <Overlay>
            <p className="text-neutral-300">Loading Skeleton Hero…</p>
          </Overlay>
        )}

        {status === "error" && (
          <Overlay>
            <p className="max-w-sm text-center text-sm text-red-400">
              {errorMessage ?? "Something went wrong loading the game."}
            </p>
          </Overlay>
        )}

        {status === "complete" && (
          <Overlay>
            <div className="w-full max-w-sm rounded border border-neutral-800 bg-neutral-950 p-4 text-center">
              <p className="text-lg font-semibold text-[#6ABC46]">Level complete!</p>
              <p className="mt-1 text-neutral-300">Final score: {score}</p>

              <div className="mt-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Leaderboard
                </p>
                {leaderboard === null ? (
                  <p className="text-xs text-neutral-500">Loading…</p>
                ) : leaderboard.length === 0 ? (
                  <p className="text-xs text-neutral-500">No scores yet — you&apos;re the first!</p>
                ) : (
                  <ol className="flex flex-col gap-1 text-sm">
                    {leaderboard.map((row, i) => (
                      <li
                        key={`${row.display_name}-${row.created_at}`}
                        className="flex items-center justify-between rounded px-2 py-1 odd:bg-neutral-900"
                      >
                        <span className="text-neutral-300">
                          {i + 1}. {row.display_name}
                        </span>
                        <span className="font-semibold text-neutral-100">{row.score}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <button
                type="button"
                onClick={handlePlayAgain}
                className="mt-4 rounded bg-[#6ABC46] px-3 py-1.5 text-sm font-semibold text-black hover:bg-[#5aa93b]"
              >
                Play again
              </button>
            </div>
          </Overlay>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4">
      {children}
    </div>
  );
}
