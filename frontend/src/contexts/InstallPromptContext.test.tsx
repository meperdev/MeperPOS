import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  InstallPromptProvider,
  useInstallPrompt,
} from "@/contexts/InstallPromptContext";
import type { BeforeInstallPromptEvent } from "@/lib/install-prompt";
import { InstallAppCard } from "@/app/settings/_components/InstallAppCard";

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPADOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function ProviderOnly({ children }: { children: ReactNode }) {
  return <InstallPromptProvider>{children}</InstallPromptProvider>;
}

/** jsdom implements neither matchMedia nor the iPad touch-point signal. */
function stubEnvironment(options: {
  standalone?: boolean;
  userAgent?: string;
  maxTouchPoints?: number;
} = {}) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: options.standalone === true && query.includes("standalone"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  Object.defineProperty(navigator, "userAgent", {
    value: options.userAgent ?? DESKTOP_UA,
    configurable: true,
  });
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: options.maxTouchPoints ?? 0,
    configurable: true,
  });
}

function fireInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt") as BeforeInstallPromptEvent;
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });

  act(() => {
    window.dispatchEvent(event);
  });

  return event;
}

function renderInstallPrompt() {
  return renderHook(() => useInstallPrompt(), { wrapper: ProviderOnly });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("install prompt lifetime", () => {
  it("captures the prompt on a page that offers no install, and still has it on the settings screen", () => {
    stubEnvironment();

    // The app boots on the dashboard. Nothing on that page consumes the install
    // surface, yet the root-layout provider is already listening.
    const { rerender } = render(
      <InstallPromptProvider>
        <p>dashboard</p>
      </InstallPromptProvider>,
    );

    fireInstallPrompt("accepted");

    // Navigating to settings swaps the page but never unmounts the provider.
    rerender(
      <InstallPromptProvider>
        <InstallAppCard />
      </InstallPromptProvider>,
    );

    expect(
      screen.getByRole("button", { name: /instalar/i }),
    ).toBeInTheDocument();
  });

  it("keeps a pending install offer across a page that has no install UI", () => {
    stubEnvironment();
    const { rerender } = render(
      <InstallPromptProvider>
        <InstallAppCard />
      </InstallPromptProvider>,
    );

    fireInstallPrompt("accepted");
    expect(screen.getByRole("button", { name: /instalar/i })).toBeInTheDocument();

    rerender(
      <InstallPromptProvider>
        <p>pos</p>
      </InstallPromptProvider>,
    );
    rerender(
      <InstallPromptProvider>
        <InstallAppCard />
      </InstallPromptProvider>,
    );

    expect(screen.getByRole("button", { name: /instalar/i })).toBeInTheDocument();
  });

  it("releases every global listener when the provider finally unmounts", () => {
    stubEnvironment();
    const removeEventListener = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(
      <InstallPromptProvider>
        <p>dashboard</p>
      </InstallPromptProvider>,
    );
    unmount();

    const removed = removeEventListener.mock.calls.map(([type]) => type);
    expect(removed).toContain("beforeinstallprompt");
    expect(removed).toContain("appinstalled");
  });
});

describe("install prompt on Chromium", () => {
  it("stays quiet until the browser offers an install prompt", () => {
    stubEnvironment();

    const { result } = renderInstallPrompt();

    expect(result.current.canPromptInstall).toBe(false);
    expect(result.current.needsManualInstall).toBe(false);
    expect(result.current.isAvailable).toBe(false);
  });

  it("captures the prompt, suppresses the browser banner and replays it on demand", async () => {
    stubEnvironment();
    const preventDefault = vi.spyOn(Event.prototype, "preventDefault");

    const { result } = renderInstallPrompt();
    const event = fireInstallPrompt("accepted");

    // Suppressing the browser's own banner is what lets the app decide where
    // and how to offer installation.
    expect(preventDefault).toHaveBeenCalled();
    expect(result.current.canPromptInstall).toBe(true);
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.needsManualInstall).toBe(false);

    await expect(result.current.promptInstall()).resolves.toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("reports a dismissed prompt", async () => {
    stubEnvironment();

    const { result } = renderInstallPrompt();
    fireInstallPrompt("dismissed");

    await expect(result.current.promptInstall()).resolves.toBe("dismissed");
  });

  it("consumes the single-use prompt event", async () => {
    stubEnvironment();

    const { result } = renderInstallPrompt();
    fireInstallPrompt();

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(result.current.canPromptInstall).toBe(false);
    await expect(result.current.promptInstall()).resolves.toBe("unavailable");
  });

  it("cannot replay the event even before the state update flushes", () => {
    stubEnvironment();

    const { result } = renderInstallPrompt();
    const event = fireInstallPrompt();

    // Two calls in the same tick: React state has not re-rendered yet, so only
    // the synchronous latch can stop the second one.
    let first: Promise<string> | undefined;
    let second: Promise<string> | undefined;
    act(() => {
      first = result.current.promptInstall();
      second = result.current.promptInstall();
    });

    return Promise.all([first, second]).then(([a, b]) => {
      expect(event.prompt).toHaveBeenCalledTimes(1);
      expect([a, b].filter((outcome) => outcome === "accepted")).toHaveLength(1);
      expect([a, b]).toContain("unavailable");
    });
  });

  it("refuses to prompt when the browser never offered one", async () => {
    stubEnvironment();

    const { result } = renderInstallPrompt();

    await expect(result.current.promptInstall()).resolves.toBe("unavailable");
  });

  it("marks the app installed when the browser confirms it", () => {
    stubEnvironment();

    const { result } = renderInstallPrompt();
    fireInstallPrompt();

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isAvailable).toBe(false);
  });
});

describe("install prompt on iOS", () => {
  it("offers the manual recipe, because WebKit never fires an install prompt", () => {
    stubEnvironment({ userAgent: IOS_UA });

    const { result } = renderInstallPrompt();

    expect(result.current.canPromptInstall).toBe(false);
    expect(result.current.needsManualInstall).toBe(true);
    expect(result.current.isAvailable).toBe(true);
  });

  it("detects iPadOS, which reports a desktop Mac user agent", () => {
    stubEnvironment({ userAgent: IPADOS_UA, maxTouchPoints: 5 });

    const { result } = renderInstallPrompt();

    expect(result.current.needsManualInstall).toBe(true);
  });

  it("does not mistake a real Mac for an iPad", () => {
    stubEnvironment({ userAgent: IPADOS_UA, maxTouchPoints: 0 });

    const { result } = renderInstallPrompt();

    expect(result.current.needsManualInstall).toBe(false);
    expect(result.current.isAvailable).toBe(false);
  });
});

describe("install prompt already installed", () => {
  it("offers nothing when running from the home screen", () => {
    stubEnvironment({ standalone: true });

    const { result } = renderInstallPrompt();

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isAvailable).toBe(false);
  });

  it("offers nothing on the WebKit standalone flag", () => {
    stubEnvironment({ userAgent: IOS_UA });
    Object.defineProperty(navigator, "standalone", {
      value: true,
      configurable: true,
    });

    const { result } = renderInstallPrompt();

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isAvailable).toBe(false);
  });
});

describe("install prompt without a provider", () => {
  it("degrades to nothing to install instead of crashing the screen", () => {
    stubEnvironment();

    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.isAvailable).toBe(false);
  });
});
