"use client";

import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  WhatsAppDelivery,
  WhatsAppIdentity,
  WhatsAppLinkChallenge,
  WhatsAppQrImage,
  WhatsAppReportOutcome,
  WhatsAppSessionState,
} from "@/types";

/**
 * Every WhatsApp read hangs off this one root key, so a mutation invalidates the
 * whole surface with `["whatsapp"]` and no screen can keep a stale status, link
 * list or history after an action.
 */
const WHATSAPP_KEY = "whatsapp";

/** The session can drift on its own (QR scanned, phone dropped), so it polls. */
const SESSION_POLL_MS = 20_000;

export function useWhatsAppStatus() {
  return useQuery({
    queryKey: [WHATSAPP_KEY, "session"],
    queryFn: () =>
      api
        .get<WhatsAppSessionState>("/whatsapp/commercial/session")
        .then((res) => res.data),
    refetchInterval: SESSION_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * The pairing image, fetched only when the operator asks for it.
 *
 * A QR is a login credential with a short life, so this query holds nothing:
 * `enabled` keeps it from running on mount, `staleTime: 0` marks the image stale
 * the moment it lands and `gcTime: 0` drops it from the cache as soon as the panel
 * stops using it. Asking again always refetches.
 */
export function useWhatsAppQr(enabled: boolean) {
  return useQuery({
    queryKey: [WHATSAPP_KEY, "session", "qr"],
    queryFn: () =>
      api
        .get<WhatsAppQrImage>("/whatsapp/commercial/session/qr")
        .then((res) => res.data),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Ensure the commercial session exists and start it. */
export function useWhatsAppConnect() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api
        .post<WhatsAppSessionState>("/whatsapp/commercial/session")
        .then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WHATSAPP_KEY] });
    },
  });
}

export function useWhatsAppStop() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api
        .post("/whatsapp/commercial/session/stop")
        .then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WHATSAPP_KEY] });
    },
  });
}

export function useWhatsAppRestart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api
        .post("/whatsapp/commercial/session/restart")
        .then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WHATSAPP_KEY] });
    },
  });
}

/**
 * The numbers the calling user linked inside their own organization. An optional
 * interval lets a screen watch for a link that is being completed from a phone.
 */
export function useWhatsAppIdentities(pollMs?: number) {
  return useQuery({
    queryKey: [WHATSAPP_KEY, "identities"],
    queryFn: () =>
      api
        .get<WhatsAppIdentity[]>("/whatsapp/identity")
        .then((res) => res.data),
    ...(pollMs ? { refetchInterval: pollMs } : {}),
  });
}

/**
 * Ask for a one-time link code. It lives in the mutation result and nowhere else:
 * no query cache, no invalidation, so it cannot be re-rendered from storage after
 * the operator has read it.
 */
export function useWhatsAppChallenge() {
  return useMutation({
    mutationFn: () =>
      api
        .post<WhatsAppLinkChallenge>("/whatsapp/identity/challenge")
        .then((res) => res.data),
  });
}

export function useWhatsAppRevokeIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      api.delete(`/whatsapp/identity/${id}`).then((res) => res.data),
    onSuccess: () => {
      // A revoked number can no longer receive a report, so the history and the
      // link list both change meaning.
      queryClient.invalidateQueries({ queryKey: [WHATSAPP_KEY] });
    },
  });
}

/** Recent report attempts of the calling organization, newest first. */
export function useWhatsAppDeliveries() {
  return useQuery({
    queryKey: [WHATSAPP_KEY, "deliveries"],
    queryFn: () =>
      api
        .get<WhatsAppDelivery[]>("/whatsapp/deliveries")
        .then((res) => res.data),
  });
}

/**
 * The 409 that answers "there is no verified number to send this to" is an
 * outcome, not a fault: it is folded back into the result so the screen can offer
 * the link action instead of showing an error box over a working page.
 */
function noIdentityOutcome(error: unknown): WhatsAppReportOutcome | null {
  if (!axios.isAxiosError(error)) return null;
  if (error.response?.status !== 409) return null;
  const body = error.response.data as { status?: unknown } | undefined;
  if (body?.status !== "no_identity") return null;
  return { status: "no_identity", reason: "no_recipient" };
}

/** Send the daily report now to the caller's own verified number. */
export function useWhatsAppSendReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<WhatsAppReportOutcome> => {
      try {
        const response = await api.post<WhatsAppReportOutcome>(
          "/whatsapp/deliveries/report",
        );
        return response.data;
      } catch (error) {
        const outcome = noIdentityOutcome(error);
        if (outcome) return outcome;
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [WHATSAPP_KEY, "deliveries"] });
    },
  });
}
