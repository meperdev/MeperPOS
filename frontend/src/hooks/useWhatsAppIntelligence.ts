"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  WhatsAppCentralSession,
  WhatsAppQrImage,
  WhatsAppSessionState,
} from "@/types";

/**
 * The central channel is a platform resource, not a tenant one: it has no
 * organization scope and only a SuperAdmin can reach it. Its reads therefore hang
 * off their own root key instead of the organization-scoped `whatsapp` one, so a
 * commercial action can never invalidate what this console shows.
 */
const CENTRAL_KEY = "whatsapp-intelligence";

/** A phone can drop or a scan can land at any moment, so the state polls. */
const SESSION_POLL_MS = 20_000;

const SESSION_PATH = "/whatsapp/intelligence/session";

export function useCentralSession() {
  return useQuery({
    queryKey: [CENTRAL_KEY, "session"],
    queryFn: () =>
      api
        .get<WhatsAppCentralSession>(SESSION_PATH)
        .then((res) => res.data),
    refetchInterval: SESSION_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * The pairing image, fetched only once the operator asks for it. Same reasoning
 * as the commercial screen: a QR is a short-lived login credential, so nothing
 * is held, nothing is reused, and asking again always refetches.
 */
export function useCentralSessionQr(enabled: boolean) {
  return useQuery({
    queryKey: [CENTRAL_KEY, "session", "qr"],
    queryFn: () =>
      api.get<WhatsAppQrImage>(`${SESSION_PATH}/qr`).then((res) => res.data),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

function useCentralMutation<TResult>(path: string, method: "post") {
  const queryClient = useQueryClient();
  return useMutation<TResult, unknown, void>({
    mutationFn: () => api[method]<TResult>(path).then((res) => res.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [CENTRAL_KEY] });
    },
  });
}

/** Create the central session when missing and start it. */
export function useCentralConnect() {
  return useCentralMutation<WhatsAppSessionState>(SESSION_PATH, "post");
}

/**
 * Unlink and start again in one request. The two steps are not chained here on
 * purpose: a failed second call from the screen would leave the number unlinked
 * with no one watching, so the backend owns the order.
 */
export function useCentralRelink() {
  return useCentralMutation<WhatsAppSessionState>(`${SESSION_PATH}/relink`, "post");
}

export function useCentralStop() {
  return useCentralMutation<void>(`${SESSION_PATH}/stop`, "post");
}

export function useCentralRestart() {
  return useCentralMutation<void>(`${SESSION_PATH}/restart`, "post");
}

export function useCentralLogout() {
  return useCentralMutation<void>(`${SESSION_PATH}/logout`, "post");
}
