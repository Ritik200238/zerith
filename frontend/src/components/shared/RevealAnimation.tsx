"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Lock, Unlock } from "lucide-react";

interface RevealAnimationProps {
  /** The final value to reveal */
  value: string;
  /** Whether to start the animation */
  active: boolean;
  /** Duration in ms for the full scramble-to-reveal (default 2000) */
  duration?: number;
  /** Label shown above the value */
  label?: string;
  /** Callback when reveal completes */
  onComplete?: () => void;
}

const CHARS = "0123456789ABCDEFabcdef";

/**
 * Scrambled-digit reveal animation.
 * Digits start randomized and progressively lock in from left to right.
 * Used when auction results or clearing prices are decrypted.
 */
export function RevealAnimation({
  value,
  active,
  duration = 2000,
  label = "Decrypted Value",
  onComplete,
}: RevealAnimationProps) {
  const [display, setDisplay] = useState<string[]>(() =>
    value.split("").map(() => CHARS[Math.floor(Math.random() * CHARS.length)])
  );
  const [revealed, setRevealed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completeCalled = useRef(false);

  const cleanup = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setRevealed(false);
      completeCalled.current = false;
      setDisplay(value.split("").map(() => CHARS[Math.floor(Math.random() * CHARS.length)]));
      return;
    }

    const chars = value.split("");
    const total = chars.length;
    const stepTime = duration / (total + 5); // extra ticks for scramble effect
    let lockedCount = 0;
    let tick = 0;

    intervalRef.current = setInterval(() => {
      tick++;

      // Lock in one character every few ticks
      if (tick > 3 && tick % 2 === 0 && lockedCount < total) {
        lockedCount++;
      }

      setDisplay(
        chars.map((ch, i) => {
          if (i < lockedCount) return ch; // locked
          return CHARS[Math.floor(Math.random() * CHARS.length)]; // still scrambling
        })
      );

      if (lockedCount >= total) {
        cleanup();
        setRevealed(true);
        if (!completeCalled.current) {
          completeCalled.current = true;
          onComplete?.();
        }
      }
    }, stepTime);

    return cleanup;
  }, [active, value, duration, onComplete, cleanup]);

  if (!active && !revealed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="editorial-card p-5 text-center space-y-3"
    >
      <div className="flex items-center justify-center gap-2">
        {revealed ? (
          <Unlock size={12} style={{ color: "var(--success)" }} />
        ) : (
          <Lock size={12} className="animate-pulse" style={{ color: "var(--text-muted)" }} />
        )}
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          <span style={{ opacity: 0.5 }}>— </span>
          {label}
        </span>
      </div>

      <div className="flex items-center justify-center gap-[2px]">
        {display.map((ch, i) => (
          <motion.span
            key={i}
            animate={{
              color: revealed ? "var(--text)" : "var(--text-muted)",
            }}
            className="font-mono font-bold inline-block w-[1.2ch] text-center"
            style={{
              fontSize: 26,
              letterSpacing: "-0.01em",
              color: revealed ? "var(--text)" : "var(--text-muted)",
            }}
          >
            {ch}
          </motion.span>
        ))}
      </div>

      {revealed && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="font-mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--success)",
          }}
        >
          Decryption complete
        </motion.p>
      )}
    </motion.div>
  );
}
