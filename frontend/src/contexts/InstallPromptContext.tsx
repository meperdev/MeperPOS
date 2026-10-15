"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  UNAVAILABLE_INSTALL_STATE,
  isConsumedEvent,
  isIosDevice,
  isStandaloneDisplay,
  serverIsStandalone,
  subscribeToDisplayMode,
  type BeforeInstallPromptEvent,
  type InstallOutcome,
  type InstallPromptState,
} from "@/lib/install-prompt";

const InstallPromptContext = createContext<InstallPromptState | null>(null);

/**
 * Owns the install prompt for the whole app.
 *
 * It has to live above every page, and not inside the screen that offers the
 * install, because `beforeinstallprompt` fires once, early, on whatever route
 * the operator happens to be on. A listener mounted by the settings card would
 * miss every event that fires anywhere else.
 */
export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installConfirmed, setInstallConfirmed] = useState(false);

  /** Synchronous single-use latch: React state is not visible within a tick. */
  const consumedEvent = useRef<BeforeInstallPromptEvent | null>(null);

  const isStandalone = useSyncExternalStore(
    subscribeToDisplayMode,
    isStandaloneDisplay,
    serverIsStandalone,
  );

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      // Suppressing the browser's mini-infobar is what lets the app offer the
      // install in its own place, with its own wording.
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };

    // On Android the app installs into the launcher while this tab stays an
    // ordinary browser tab, so the display mode never changes and this event is
    // the only signal that installation happened.
    const handleInstalled = () => setInstallConfirmed(true);

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    if (!promptEvent || isConsumedEvent(consumedEvent.current, promptEvent)) {
      return "unavailable";
    }

    // Latched before awaiting, and the state dropped with it, so the event can
    // never be replayed however the user answers.
    consumedEvent.current = promptEvent;
    setPromptEvent(null);

    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    return outcome;
  }, [promptEvent]);

  const isInstalled = isStandalone || installConfirmed;
  /**
   * Derived from state alone. The consumed-event latch is deliberately not read
   * here: a ref read during render is invisible to memoisation, and the state
   * reset in `promptInstall` already covers this path once it flushes.
   */
  const canPromptInstall = promptEvent !== null && !isInstalled;
  const needsManualInstall = !isInstalled && !canPromptInstall && isIosDevice();

  return (
    <InstallPromptContext.Provider
      value={{
        isInstalled,
        canPromptInstall,
        needsManualInstall,
        isAvailable: canPromptInstall || needsManualInstall,
        promptInstall,
      }}
    >
      {children}
    </InstallPromptContext.Provider>
  );
}

/**
 * Reads the install surface. Used outside the provider it degrades to "nothing
 * to install" rather than throwing, because a missing provider must not be able
 * to take the settings screen down.
 */
export function useInstallPrompt(): InstallPromptState {
  return useContext(InstallPromptContext) ?? UNAVAILABLE_INSTALL_STATE;
}
