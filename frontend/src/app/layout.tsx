import React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../styles/globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthProvider } from "@/hooks/useAuth";
import { TxStatusProvider } from "@/hooks/useTxStatus";
import { WalletProvider } from "@/hooks/useWallet";
import { NotificationProvider } from "@/contexts/NotificationContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ArenaX",
  description: "Competitive Gaming Platform",
};

import { PerformanceMonitor } from "@/components/common/PerformanceMonitor";
import { ServiceWorkerRegistration } from "@/components/common/ServiceWorkerRegistration";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <PerformanceMonitor />
        <ServiceWorkerRegistration />
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
                  <NotificationProvider>
                    <AppLayout>{children}</AppLayout>
                  </NotificationProvider>
                </TxStatusProvider>
              </WalletProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
