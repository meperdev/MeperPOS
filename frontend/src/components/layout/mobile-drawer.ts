"use client";

import { useSyncExternalStore } from "react";

/**
 * Open state of the mobile navigation drawer.
 *
 * A module-level store rather than context state because the drawer and its only
 * opener are siblings with different owners: `Sidebar` renders the drawer and
 * `MobileTabBar`'s "Más" opens it ("Más" replaced the hamburger as the way in).
 * A store keeps each of them mountable on its own — a context would force every
 * test or story of either component to wrap it in a provider — and the server
 * snapshot is always `false`, so hydration cannot disagree with the markup.
 *
 * There is one authenticated shell, so one drawer: nothing here needs to be
 * scoped beyond the document.
 */
let isDrawerOpen = false;
const listeners = new Set<() => void>();

function emit(next: boolean): void {
  if (next === isDrawerOpen) return;
  isDrawerOpen = next;
  listeners.forEach((listener) => listener());
}

export function subscribeMobileDrawer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isMobileDrawerOpen(): boolean {
  return isDrawerOpen;
}

export function openMobileDrawer(): void {
  emit(true);
}

export function closeMobileDrawer(): void {
  emit(false);
}

export function toggleMobileDrawer(): void {
  emit(!isDrawerOpen);
}

function getServerSnapshot(): boolean {
  return false;
}

export interface MobileDrawerState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useMobileDrawer(): MobileDrawerState {
  const isOpen = useSyncExternalStore(
    subscribeMobileDrawer,
    isMobileDrawerOpen,
    getServerSnapshot,
  );

  return {
    isOpen,
    open: openMobileDrawer,
    close: closeMobileDrawer,
    toggle: toggleMobileDrawer,
  };
}
