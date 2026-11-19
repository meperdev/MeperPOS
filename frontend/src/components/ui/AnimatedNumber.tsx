"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** One column's worth of digits, top to bottom: the array index is the digit. */
const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Roll duration, the per-column stagger and the ceiling that stagger may reach. */
const ROLL_MS = 600;
const STAGGER_MS = 20;
const MAX_STAGGER_MS = 100;
/** Kept in sync with the `.animated-number-column-in` keyframes in globals.css. */
const COLUMN_ENTER_MS = 380;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const DIVERGING_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const DIGIT_PATTERN = /^\d$/;

function subscribeToReducedMotion(onStoreChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener?.("change", onStoreChange);
  return () => query.removeEventListener?.("change", onStoreChange);
}

function hasReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function usePrefersReducedMotion() {
  // The reader can flip the preference mid-session, so this is a live query and
  // not a one-shot read. The server has no preference: assume motion.
  return useSyncExternalStore(subscribeToReducedMotion, hasReducedMotion, () => false);
}

interface AnimatedNumberProps {
  /**
   * Already formatted string — `formatCurrency` output or a grouped count. The
   * component never formats, rounds or computes: it only paints the characters
   * it is given, so the number on screen stays exactly the server's.
   */
  value: string;
  className?: string;
}

/**
 * Odometer counter for KPI values. Every digit character becomes a column with
 * the digits 0-9 stacked; a change translates the column to the new digit, one
 * easing for all of them and a small right-to-left stagger so the last digit
 * leads. The first render paints the value in place — nothing counts up on page
 * load — and only later changes roll.
 *
 * The strips are decoration and stay out of the accessibility tree: a single
 * `sr-only` span carries the whole string, so a reader hears "$ 1.234.567" once.
 */
export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  /**
   * What the strips currently paint. It trails `value` only for the render in
   * which the value changed, which React discards: adjusting it here (the
   * documented "state follows a prop" path) commits the new digits and the
   * transition in one pass, so the browser interpolates from the old ones.
   */
  const [painted, setPainted] = useState(() => ({
    value,
    /** Columns added by this change start fading in at this index. */
    newFrom: null as number | null,
    /** A value has changed at least once: transitions are live from now on. */
    rolled: false,
  }));

  if (painted.value !== value) {
    setPainted({
      value,
      newFrom:
        prefersReducedMotion || value.length <= painted.value.length
          ? null
          : painted.value.length,
      rolled: true,
    });
  }

  useEffect(() => {
    if (painted.newFrom === null) return;

    const timer = setTimeout(
      () => setPainted((current) => ({ ...current, newFrom: null })),
      COLUMN_ENTER_MS + MAX_STAGGER_MS,
    );
    return () => clearTimeout(timer);
  }, [painted.newFrom]);

  const shown = painted.value;
  const newFrom = painted.newFrom;
  const characters = Array.from(shown);
  // Right-to-left stagger: the rightmost digit starts first, and long values
  // cap the total delay instead of trailing far behind the change.
  const staggerByIndex = new Map<number, number>();
  let ordinal = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    if (DIGIT_PATTERN.test(characters[index])) {
      staggerByIndex.set(index, Math.min(ordinal * STAGGER_MS, MAX_STAGGER_MS));
      ordinal += 1;
    }
  }
  const animating = painted.rolled && !prefersReducedMotion;

  return (
    <span
      data-testid="animated-number"
      className={cn("inline-flex tabular-nums", className)}
    >
      <span
        data-testid="animated-number-strips"
        aria-hidden="true"
        className="inline-flex items-baseline whitespace-pre"
      >
        {characters.map((character, index) => {
          const isNew = newFrom !== null && index >= newFrom;

          if (!DIGIT_PATTERN.test(character)) {
            return (
              // Keyed by position, not by character: a column keeps its DOM node
              // across changes so the browser has a previous transform to roll from.
              <span
                key={index}
                data-static-char={character}
                data-column-new={isNew || undefined}
                className={cn("whitespace-pre", isNew && "animated-number-column-in")}
              >
                {character}
              </span>
            );
          }

          const style: CSSProperties = { transform: `translateY(-${character}em)` };
          if (animating) {
            style.transitionProperty = "transform";
            style.transitionDuration = `${ROLL_MS}ms`;
            style.transitionTimingFunction = DIVERGING_EASE;
            style.transitionDelay = `${staggerByIndex.get(index) ?? 0}ms`;
          }

          return (
            <span
              key={index}
              data-column-new={isNew || undefined}
              className={cn(
                "animated-number-column relative inline-block h-[1em] w-[1ch] overflow-hidden align-bottom",
                isNew && "animated-number-column-in",
              )}
            >
              <span
                data-testid="animated-number-strip"
                data-digit={character}
                data-rolling={animating || undefined}
                style={style}
                className={cn("flex flex-col items-center", animating && "will-change-transform")}
              >
                {DIGITS.map((digit) => (
                  <span
                    key={digit}
                    className="block h-[1em] w-full text-center leading-[1em]"
                  >
                    {digit}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
