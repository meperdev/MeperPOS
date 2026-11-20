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
 * One family for the whole product: Inter, self-hosted as a latin WOFF2 file so
 * production builds never depend on a Google Fonts request. The `next/font/google`
 * loader downloads fonts at build time and fails the whole build whenever that
 * request returns an unexpected payload.
 *
 * The face is Inter's variable font, subset to latin with both axes
 * (opsz 14-32, wght 100-900) and the features the UI uses kept: tabular
 * numbers (tnum), contextual alternates (calt), cv11 and ss01. Identifiers —
 * SKU, barcode, sale and purchase-order numbers, NIT, phone — ride this same
 * face with tabular figures (`.id-text` in globals.css); no second family is
 * loaded for them.
 */
const inter = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-sans-face",
  display: "swap",
  weight: "100 900",
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
      <body className={`${inter.variable} antialiased`}>
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
