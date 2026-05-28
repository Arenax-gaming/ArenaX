"use client";

import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { WalletDashboard } from "@/components/wallet/WalletDashboard";

export default function WalletPage() {
  return (
    <ProtectedPage>
      <WalletDashboard />
    </ProtectedPage>
  );
}
