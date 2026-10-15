import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { InstallAppCard } from "@/app/settings/_components/InstallAppCard";
import type { BeforeInstallPromptEvent } from "@/hooks/useInstallPrompt";

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function stubUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
}

function fireInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt") as BeforeInstallPromptEvent;
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });

  fireEvent(window, event);
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InstallAppCard", () => {
  it("renders nothing when the platform offers no way to install", () => {
    stubUserAgent(DESKTOP_UA);

    const { container } = render(<InstallAppCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it("installs in one tap on Chromium through the captured prompt", async () => {
    stubUserAgent(DESKTOP_UA);
    render(<InstallAppCard />);

    const event = fireInstallPrompt("accepted");
    const button = await screen.findByRole("button", { name: /instalar/i });

    fireEvent.click(button);

    await waitFor(() => expect(event.prompt).toHaveBeenCalledTimes(1));
  });

  it("explains the Share sheet on iOS, where no install prompt can fire", () => {
    stubUserAgent(IOS_UA);

    render(<InstallAppCard />);

    expect(screen.getByText(/Añadir a pantalla de inicio/i)).toBeInTheDocument();
    expect(screen.getByText(/Compartir/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^instalar$/i }),
    ).not.toBeInTheDocument();
  });

  it("stops offering the install once the browser confirms it", async () => {
    stubUserAgent(DESKTOP_UA);
    const { container } = render(<InstallAppCard />);

    fireInstallPrompt();

    expect(await screen.findByRole("button", { name: /instalar/i })).toBeInTheDocument();

    fireEvent(window, new Event("appinstalled"));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
