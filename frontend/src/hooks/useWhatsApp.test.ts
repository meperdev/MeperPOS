import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { WhatsAppAutomaticSend } from "@/types";
import { useWhatsAppAutomaticSend, useWhatsAppSendReport } from "./useWhatsApp";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const apiMock = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

const automatic: WhatsAppAutomaticSend = {
  state: "active",
  consecutiveFailures: 0,
  pausedSince: null,
  nextRunAt: "2026-11-17T01:00:00.000Z",
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("useWhatsAppAutomaticSend", () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
  });

  it("reads the automatic send state from its own endpoint", async () => {
    apiMock.get.mockResolvedValue({ data: automatic });

    const { result } = renderHook(() => useWhatsAppAutomaticSend(), {
      wrapper: wrapperFor(makeClient()),
    });

    await waitFor(() => expect(result.current.data).toEqual(automatic));
    expect(apiMock.get).toHaveBeenCalledWith("/whatsapp/deliveries/automatic");
  });

  it("refreshes both the history and the state after a manual send", async () => {
    apiMock.post.mockResolvedValue({
      data: { status: "sent", providerMessageId: "wamid-1" },
    });
    const client = makeClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useWhatsAppSendReport(), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    // A successful manual send is the resume action, so the paused card and the
    // history it explains both have to be re-read.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["whatsapp", "deliveries"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["whatsapp", "deliveries", "automatic"],
    });
  });

  it("folds the missing-identity 409 back into an outcome, not an error", async () => {
    apiMock.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { status: "no_identity" } },
    });
    // `axios.isAxiosError` reads the flag, so a shaped rejection is enough.
    const { result } = renderHook(() => useWhatsAppSendReport(), {
      wrapper: wrapperFor(makeClient()),
    });

    await expect(result.current.mutateAsync()).resolves.toEqual({
      status: "no_identity",
      reason: "no_recipient",
    });
  });
});
