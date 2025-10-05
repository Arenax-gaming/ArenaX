import type { Metadata } from "next";
import "./globals.css";

import RegisterSW from "../components/RegisterSW";

export const metadata: Metadata = {
  title: "ArenaX",
  description: "Esports tournaments and wallet platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#18181b" />
      </head>
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
