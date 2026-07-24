"use client";

import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { WalletDashboard } from "@/components/wallet/WalletDashboard";
import { PageErrorBoundary } from "@/components/common/PageErrorBoundary";

export default function WalletPage() {
  return (
    <ProtectedPage>
      <PageErrorBoundary
        title="Wallet unavailable"
        message="We couldn't load your wallet data. Check your connection and try again."
      >
        <WalletDashboard />
      </PageErrorBoundary>
    </ProtectedPage>
  );
}
