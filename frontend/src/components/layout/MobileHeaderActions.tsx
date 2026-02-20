"use client";

import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { MobileNav } from "@/components/layout/MobileNav";

export function MobileHeaderActions() {
  return (
    <div className="flex items-center gap-2 md:hidden">
      <NotificationBell />
      <ThemeToggle />
      <MobileNav />
    </div>
  );
}
