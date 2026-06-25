import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, useMessages } from "next-intl";
import { routing, Locale } from "@/i18n/routing";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AccessibilityProvider } from "@/components/providers/AccessibilityProvider";
import { ErrorProvider } from "@/components/providers/ErrorProvider";
import { CollaborationProvider } from "@/components/providers/CollaborationProvider";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/hooks/useAuth";
import { TxStatusProvider } from "@/hooks/useTxStatus";
import { WalletProvider } from "@/hooks/useWallet";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { WebVitalsInit } from "@/components/providers/WebVitalsInit";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const rtlLocales: Locale[] = ["ar"];

export const metadata: Metadata = {
  title: "ArenaX",
  description: "Competitive Gaming Platform",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ArenaX",
  },
  other: {
    "mobile-web-app-capable": "yes",
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
  params,
}: {
  children: React.ReactNode;
  params: { locale: Locale };
}) {
  const { locale } = params;
  
  if (!routing.locales.includes(locale)) {
    notFound();
  }

  const messages = useMessages();
  const isRtl = rtlLocales.includes(locale);

  return (
    <html lang={locale} dir={isRtl ? "rtl" : "ltr"} suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/icons/icon-512x512.png" />
      </head>
      <body className="font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            storageKey="theme"
          >
            <ErrorProvider>
              <CollaborationProvider>
                <ErrorBoundary>
                  <AccessibilityProvider>
                    <QueryProvider>
                      <AuthProvider>
                        <WalletProvider>
                          <TxStatusProvider>
                            <NotificationProvider>
                              <AppLayout>{children}</AppLayout>
                            </NotificationProvider>
                          </TxStatusProvider>
                        </WalletProvider>
                      </AuthProvider>
                    </QueryProvider>
                  </AccessibilityProvider>
                </ErrorBoundary>
              </CollaborationProvider>
            </ErrorProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
