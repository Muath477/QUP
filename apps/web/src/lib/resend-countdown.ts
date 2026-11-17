"use client";

import { useEffect, useState } from "react";

import { isApiError } from "./api";

const TICK_MS = 1_000;
const MS_PER_SECOND = 1_000;

/**
 * How long the API says to wait before another code (`details.retryAfterSeconds`
 * on 429 CODE_REQUESTED_TOO_OFTEN), or null for any other error.
 */
export function retryAfterSeconds(error: unknown): number | null {
  if (!isApiError(error, "CODE_REQUESTED_TOO_OFTEN")) return null;
  const details = error.details as { retryAfterSeconds?: unknown } | null;
  return typeof details?.retryAfterSeconds === "number" ? details.retryAfterSeconds : null;
}

/** Whole seconds left until `until`, never negative. Pure: `now` is a parameter. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / MS_PER_SECOND));
}

/**
 * A "send again" button's wait: counts down once per second from the moment
 * `start(seconds)` is called. The server enforces the real cooldown; this only
 * keeps the button honest so the person is not told to wait by an error.
 */
export function useResendCountdown(): { seconds: number; start: (seconds: number) => void } {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [until]);

  return {
    seconds: secondsLeft(until, now),
    start: (seconds) => {
      const current = Date.now();
      setNow(current);
      setUntil(current + seconds * MS_PER_SECOND);
    },
  };
}
