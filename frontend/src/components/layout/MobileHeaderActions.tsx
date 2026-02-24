"use client";

import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { UserMenu } from "@/components/layout/UserMenu";
import { MobileNav } from "@/components/layout/MobileNav";
import { useAuth } from "@/hooks/useAuth";

export function MobileHeaderActions() {
  const { user } = useAuth();
  return (
    <div className="flex items-center gap-2 md:hidden">
      <NotificationBell />
      {user && <UserMenu />}
      <ThemeToggle />
      <MobileNav />
    </div>
  );
}
