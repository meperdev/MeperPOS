"use client";

import { useRef } from "react";
import { Check } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

/**
 * Miniature palettes. A preview of the other theme cannot read the active
 * theme's custom properties, so each theme's tokens from `globals.css` are
 * repeated here as literal values: `--background`, `--card`, `--border`,
 * `--sidebar-bg`, `--sidebar-border`, `--foreground`, `--muted-foreground`
 * and `--primary`.
 */
const THEME_PREVIEWS: Record<
  Theme,
  {
    background: string;
    surface: string;
    border: string;
    rail: string;
    railBorder: string;
    text: string;
    accent: string;
  }
> = {
  light: {
    background: "#FAFAF9",
    surface: "#FFFFFF",
    border: "#D6D3D1",
    rail: "#FFFFFF",
    railBorder: "#D6D3D1",
    text: "#1C1917",
    accent: "#B0522E",
  },
  dark: {
    background: "#111114",
    surface: "#18181C",
    border: "#30303A",
    rail: "#18181C",
    railBorder: "#30303A",
    text: "#F2F2F5",
    accent: "#C25E36",
  },
};

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

/**
 * A window drawn from the theme's own tokens: sidebar strip, header bar and
 * two content cards. Geometry only — no labels, so the miniature stays
 * legible at 160px and reads as the same product in both themes.
 */
function ThemePreview({ theme }: { theme: Theme }) {
  const colors = THEME_PREVIEWS[theme];

  return (
    <span
      aria-hidden="true"
      data-theme-preview=""
      className="relative block h-[92px] w-full overflow-hidden rounded-[7px] border"
      style={{ backgroundColor: colors.background, borderColor: colors.border }}
    >
      <span
        className="absolute inset-y-0 left-0 block w-[26px] border-r"
        style={{ backgroundColor: colors.rail, borderColor: colors.railBorder }}
      >
        <span
          className="mx-[7px] mt-[8px] block h-[6px] w-[12px] rounded-[2px]"
          style={{ backgroundColor: colors.accent }}
        />
        <span
          className="mx-[7px] mt-[10px] block h-[3px] w-[12px] rounded-full"
          style={{ backgroundColor: colors.text }}
        />
        <span
          className="mx-[7px] mt-[6px] block h-[3px] w-[9px] rounded-full opacity-55"
          style={{ backgroundColor: colors.text }}
        />
        <span
          className="mx-[7px] mt-[6px] block h-[3px] w-[11px] rounded-full opacity-55"
          style={{ backgroundColor: colors.text }}
        />
      </span>

      <span
        className="absolute left-[26px] right-0 top-0 block h-[18px] border-b"
        style={{ backgroundColor: colors.surface, borderColor: colors.border }}
      >
        <span
          className="ml-[8px] mt-[6px] block h-[3px] w-[18px] rounded-full opacity-60"
          style={{ backgroundColor: colors.text }}
        />
        <span
          className="absolute right-[7px] top-[5px] block h-[8px] w-[16px] rounded-[3px] border"
          style={{ borderColor: colors.border }}
        />
      </span>

      <span className="absolute bottom-[7px] left-[26px] right-[7px] top-[25px] flex gap-[6px]">
        <span
          className="flex-1 rounded-[4px] border p-[6px]"
          style={{ backgroundColor: colors.surface, borderColor: colors.border }}
        >
          <span
            className="block h-[4px] w-[70%] rounded-full"
            style={{ backgroundColor: colors.text }}
          />
          <span
            className="mt-[5px] block h-[3px] w-[45%] rounded-full opacity-45"
            style={{ backgroundColor: colors.text }}
          />
          <span
            className="mt-[7px] block h-[5px] w-[55%] rounded-[2px]"
            style={{ backgroundColor: colors.accent }}
          />
        </span>
        <span
          className="flex-1 rounded-[4px] border p-[6px]"
          style={{ backgroundColor: colors.surface, borderColor: colors.border }}
        >
          <span
            className="block h-[4px] w-[55%] rounded-full"
            style={{ backgroundColor: colors.text }}
          />
          <span
            className="mt-[5px] block h-[3px] w-[70%] rounded-full opacity-45"
            style={{ backgroundColor: colors.text }}
          />
          <span
            className="mt-[7px] block h-[5px] w-[40%] rounded-[2px] opacity-45"
            style={{ backgroundColor: colors.text }}
          />
        </span>
      </span>
    </span>
  );
}

/**
 * The theme choice as a radio group of live miniatures. Selection applies
 * immediately through `ThemeContext`, which already owns persistence and the
 * `theme-color` repaint — this control adds no storage of its own.
 */
export function ThemeSelector() {
  const { theme, toggleTheme } = useTheme();
  const radioRefs = useRef(new Map<Theme, HTMLButtonElement | null>());

  const select = (value: Theme) => {
    if (value !== theme) toggleTheme();
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const { key } = event;

    if (
      key === "ArrowRight" ||
      key === "ArrowDown" ||
      key === "ArrowLeft" ||
      key === "ArrowUp"
    ) {
      event.preventDefault();
      const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
      const next =
        THEME_OPTIONS[(index + step + THEME_OPTIONS.length) % THEME_OPTIONS.length];
      select(next.value);
      radioRefs.current.get(next.value)?.focus();
      return;
    }

    if (key === "Enter" || key === " " || key === "Spacebar") {
      event.preventDefault();
      select(THEME_OPTIONS[index].value);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la interfaz"
      className="grid max-w-sm grid-cols-2 gap-3"
    >
      {THEME_OPTIONS.map((option, index) => {
        const isSelected = option.value === theme;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            ref={(element) => {
              radioRefs.current.set(option.value, element);
            }}
            onClick={() => select(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "relative rounded-xl p-1.5 text-left transition-shadow duration-150",
              "focus-visible:outline-none",
              isSelected
                ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "ring-1 ring-border/70 hover:ring-border",
            )}
          >
            <ThemePreview theme={option.value} />
            <span
              className={cn(
                "mt-2 block px-0.5 pb-0.5 text-[13px]",
                isSelected
                  ? "font-semibold text-foreground"
                  : "font-medium text-muted-foreground",
              )}
            >
              {option.label}
            </span>
            {isSelected && (
              <span
                data-theme-check=""
                className="absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white shadow-2xs"
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
