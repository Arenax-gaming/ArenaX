import type { Metadata, Viewport } from "next";
import "../styles/globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AccessibilityProvider } from "@/components/providers/AccessibilityProvider";
import { AppLayout } from "@/components/layout/AppLayout";
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
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: organizationStructuredData() }}
        />
        <script
          type="application/ld+json"
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
                        <AppLayout>{children}</AppLayout>
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
