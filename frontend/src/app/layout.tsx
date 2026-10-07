import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "../styles/globals.css";
import { NONCE_HEADER } from "@/lib/csp";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AccessibilityProvider } from "@/components/providers/AccessibilityProvider";
// NOTE: No AppLayout here on purpose. The locale layout
// (src/app/[locale]/layout.tsx) renders <AppLayout> INSIDE
// <NextIntlClientProvider>. Rendering it here too would (a) duplicate the
// header/footer and (b) crash with "No intl context found" because this root
// layout has no intl provider — which broke E2E dev-server readiness.
import { AuthProvider } from "@/hooks/useAuth";
import { TxStatusProvider } from "@/hooks/useTxStatus";
import { WalletProvider } from "@/hooks/useWallet";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { WebVitalsInit } from "@/components/providers/WebVitalsInit";
import { AnalyticsProvider } from "@/components/providers/AnalyticsProvider";
import { ConsentBanner } from "@/components/providers/ConsentBanner";
import { defaultMetadata, organizationStructuredData, websiteStructuredData } from "@/lib/seo";

export const metadata: Metadata = {
  ...defaultMetadata,
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ArenaX",
  },
};

export const viewport: Viewport = {
  themeColor: "#111827",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Set by middleware.ts on every request (#1091) — required for these
  // inline scripts to run under the nonce-based CSP script-src.
  const nonce = headers().get(NONCE_HEADER) ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: organizationStructuredData() }}
        />
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: websiteStructuredData() }}
        />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AccessibilityProvider>
            <QueryProvider>
              <AuthProvider>
                <WalletProvider>
                  <TxStatusProvider>
                    <NotificationProvider>
                      <AnalyticsProvider>
                        <WebVitalsInit />
                        {children}
                        <ConsentBanner />
                      </AnalyticsProvider>
                    </NotificationProvider>
                  </TxStatusProvider>
                </WalletProvider>
              </AuthProvider>
            </QueryProvider>
          </AccessibilityProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
