import type { Metadata } from "next";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { AdminKpiDashboard } from "@/components/dashboard/AdminKpiDashboard";

export const metadata: Metadata = {
  title: "Dashboard — Admin | ArenaX",
  description:
    "Admin KPI overview: daily active users, tournaments, prize pool distributed, and active disputes.",
};

/**
 * Issue #1563 — Admin dashboard page with KPI summary cards.
 * Protected server-side by the Edge middleware's `admin` route guard and
 * client-side by `ProtectedPage` (requiredRole="admin"): unauthenticated
 * users are redirected to /login, authenticated non-admins see a 403 screen.
 */
export default function AdminDashboardPage() {
  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto space-y-6 p-6">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Admin Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Key platform metrics at a glance — refreshes automatically every
            60 seconds.
          </p>
        </header>

        <AdminKpiDashboard />
      </div>
    </ProtectedPage>
  );
}
