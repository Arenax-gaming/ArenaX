"use client";

import dynamic from "next/dynamic";
import GovernanceLoading from "./loading";

// Code-split (#1325): keep governance (proposals, voting modal) out of the
// main app chunk; the route-level skeleton shows while the chunk downloads.
const GovernancePageContent = dynamic(
  () =>
    import("@/components/governance/GovernancePageContent").then(
      (m) => m.GovernancePageContent,
    ),
  { ssr: false, loading: () => <GovernanceLoading /> },
);

export default function GovernancePage() {
  return <GovernancePageContent />;
}
