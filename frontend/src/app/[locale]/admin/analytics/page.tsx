import type { Metadata } from 'next';
import { ProtectedPage } from '@/components/navigation/ProtectedPage';
import { AdminAnalyticsDashboard } from '@/components/analytics/AdminAnalyticsDashboard';

export const metadata: Metadata = {
  title: 'Analytics — Admin | ArenaX',
  description:
    'Platform analytics dashboard: DAU, revenue, tournaments, and match volume.',
};

/**
 * Issue #1412 — Admin analytics dashboard page.
 * Protected via ProtectedPage (requiredRole="admin") — unauthenticated users
 * are redirected to /login; authenticated non-admins see a 403 screen.
 */
export default function AdminAnalyticsPage() {
  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto space-y-6 p-6">
        <header>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Analytics Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform metrics — revenue, tournaments, user registrations, and
            match activity.
          </p>
        </header>

        <AdminAnalyticsDashboard />
      </div>
    </ProtectedPage>
  );
}
