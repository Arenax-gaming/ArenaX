"use client";

import Link from "next/link";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

interface QuickAction {
  title: string;
  description: string;
  href: string;
  icon: React.ReactNode;
  color: string;
}

const quickActions: QuickAction[] = [
  {
    title: "User Management",
    description: "List, search, ban and unban users",
    href: "/admin/users",
    color: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 hover:border-blue-400",
    icon: (
      <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: "Tournaments",
    description: "List, create and cancel tournaments",
    href: "/admin/tournaments",
    color: "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800 hover:border-purple-400",
    icon: (
      <svg className="w-8 h-8 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    ),
  },
  {
    title: "Finance",
    description: "Revenue summary and transaction log",
    href: "/admin/finance",
    color: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 hover:border-green-400",
    icon: (
      <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: "Disputes",
    description: "Review evidence and resolve match disputes",
    href: "/admin/disputes",
    color: "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800 hover:border-yellow-400",
    icon: (
      <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  {
    title: "KYC Reviews",
    description: "Verify user identities and manage account risk",
    href: "/admin/kyc",
    color: "bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800 hover:border-indigo-400",
    icon: (
      <svg className="w-8 h-8 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
      </svg>
    ),
  },
  {
    title: "Governance",
    description: "Multisig proposal management and platform updates",
    href: "/admin/governance",
    color: "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800 hover:border-rose-400",
    icon: (
      <svg className="w-8 h-8 text-rose-600 dark:text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    title: "Audit Log",
    description: "Search and filter all admin actions by actor, action, and date range",
    href: "/admin/audit-log",
    color: "bg-slate-50 dark:bg-slate-950/20 border-slate-200 dark:border-slate-800 hover:border-slate-400",
    icon: (
      <svg className="w-8 h-8 text-slate-600 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

export default function AdminDashboard() {
  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto p-6 space-y-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl text-gray-900 dark:text-gray-100">
            Admin Dashboard
          </h1>
          <p className="text-xl text-muted-foreground">
            Platform management and oversight tools.
          </p>
        </header>

        <section>
          <h2 className="text-lg font-semibold mb-4 text-gray-700 dark:text-gray-300">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActions.map((action) => (
              <Link key={action.href} href={action.href}>
                <Card className={`border-2 transition-all duration-200 cursor-pointer hover:shadow-lg ${action.color}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-4">
                      <div className="shrink-0">{action.icon}</div>
                      <div>
                        <CardTitle className="text-lg">{action.title}</CardTitle>
                        <CardDescription className="mt-1">{action.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-4">
          <Card className="border bg-muted/30">
            <CardHeader>
              <CardDescription className="text-xs font-bold uppercase tracking-widest">Platform</CardDescription>
              <CardTitle className="text-3xl font-bold">ArenaX</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Admin panel — manage users, tournaments, finances, and platform governance from one place.</p>
            </CardContent>
          </Card>
          <Card className="border bg-muted/30">
            <CardHeader>
              <CardDescription className="text-xs font-bold uppercase tracking-widest">Access Level</CardDescription>
              <CardTitle className="text-3xl font-bold">Admin</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Full administrative access. All actions are logged in the audit trail.</p>
            </CardContent>
          </Card>
          <Card className="border bg-muted/30">
            <CardHeader>
              <CardDescription className="text-xs font-bold uppercase tracking-widest">Support</CardDescription>
              <CardTitle className="text-3xl font-bold">Tools</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Use the quick actions above to navigate to specific management areas.</p>
            </CardContent>
          </Card>
        </section>
      </div>
    </ProtectedPage>
  );
}
