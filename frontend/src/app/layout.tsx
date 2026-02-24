import type { Metadata } from "next";
import "../styles/globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/hooks/useAuth";
import { TxStatusProvider } from "@/hooks/useTxStatus";
import { WalletProvider } from "@/hooks/useWallet";
import { NotificationProvider } from "@/contexts/NotificationContext";

export const metadata: Metadata = {
  title: "ArenaX",
  description: "Competitive Gaming Platform",
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
          <QueryProvider>
            <AuthProvider>
              <WalletProvider>
                <TxStatusProvider>
                  <AppLayout>{children}</AppLayout>
                </TxStatusProvider>
              </WalletProvider>
            </AuthProvider>
          </QueryProvider>
          <AuthProvider>
            <NotificationProvider>
              <AppLayout>{children}</AppLayout>
            </NotificationProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
