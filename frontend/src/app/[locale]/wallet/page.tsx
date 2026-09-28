"use client";

import dynamic from "next/dynamic";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { PageErrorBoundary } from "@/components/common/PageErrorBoundary";
import { WalletDashboardSkeleton } from "@/components/common/PageSkeleton";

// Code-split (#1086): wallet pulls in Stellar SDK + wallet-connect flows that
// don't belong in every visitor's initial JS payload.
const WalletDashboard = dynamic(
  () => import("@/components/wallet/WalletDashboard").then((m) => m.WalletDashboard),
  { ssr: false, loading: () => <WalletDashboardSkeleton /> },
);

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
