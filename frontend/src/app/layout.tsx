import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { SidebarProvider } from "@/contexts/SidebarContext";
import { InstallPromptProvider } from "@/contexts/InstallPromptContext";
import { BackGestureGuard } from "@/components/pwa/BackGestureGuard";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import { buildPwaMetadata, buildPwaViewport } from "@/lib/pwa";

/**
 * Inter (sans) and JetBrains Mono (identifiers) are self-hosted as latin
 * WOFF2 files so production builds never depend on a Google Fonts request.
 * The `next/font/google` loader downloads fonts at build time and fails the
 * whole build whenever that request returns an unexpected payload.
 *
 * The sans face is Inter's variable font, subset to latin with both axes
 * (opsz 14-32, wght 100-900) and the features the UI uses kept: tabular
 * numbers (tnum), contextual alternates (calt), cv11 and ss01.
 */
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-sans-face",
  display: "swap",
  weight: "100 900",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
});

export const metadata: Metadata = buildPwaMetadata();

export const viewport: Viewport = buildPwaViewport();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <QueryProvider>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <SidebarProvider>
                  <InstallPromptProvider>{children}</InstallPromptProvider>
                </SidebarProvider>
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </QueryProvider>
        <Analytics />
        <ServiceWorkerRegistrar />
        <BackGestureGuard />
      </body>
    </html>
  );
}
