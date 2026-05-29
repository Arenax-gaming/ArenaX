import type { Metadata } from "next";
import "../styles/globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AccessibilityProvider } from "@/components/providers/AccessibilityProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/hooks/useAuth";
import { TxStatusProvider } from "@/hooks/useTxStatus";
import { WalletProvider } from "@/hooks/useWallet";
import { NotificationProvider } from "@/contexts/NotificationContext";

export const metadata: Metadata = {
  title: "ArenaX",
  description: "Competitive Gaming Platform",
  manifest: "/manifest.json",
  themeColor: "#111827",
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ArenaX",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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
                      <AppLayout>{children}</AppLayout>
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
