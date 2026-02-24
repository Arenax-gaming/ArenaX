"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { authNav, mainNav } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/common/Logo";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Button } from "@/components/ui/Button";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { UserMenu } from "@/components/layout/UserMenu";
import { ProtectedLink } from "@/components/navigation/ProtectedLink";
import { useAuth } from "@/hooks/useAuth";

const isActiveRoute = (pathname: string, href: string) =>
  pathname === href || (href !== "/" && pathname.startsWith(href));

export function Navbar() {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  const authItems = loading
    ? []
    : user
      ? [] // Authenticated: show UserMenu instead of auth links
      : authNav.unauthenticated;

  return (
    <div className="hidden w-full items-center justify-between md:flex">
      <div className="flex items-center gap-6">
        <Logo />
        <nav className="flex items-center gap-6 text-sm font-medium">
          {mainNav.map((item) => {
            const isActive = isActiveRoute(pathname, item.href);
            const linkClass = cn(
              "transition-colors",
              isActive
                ? "text-foreground"
                : "text-foreground/60 hover:text-foreground/80"
            );
            const content = item.label;

            if (item.href === "/wallet") {
              return (
                <ProtectedLink
                  key={item.href}
                  href={item.href}
                  className={linkClass}
                  fallback={
                    <Link href={`/login?redirect=${encodeURIComponent(pathname || "/")}`} className={linkClass}>
                      {content}
                    </Link>
                  }
                >
                  {content}
                </ProtectedLink>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={linkClass}
                aria-current={isActive ? "page" : undefined}
              >
                {content}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <NotificationBell />
        {user && <UserMenu />}
        {authItems.map((item) => {
          const isActive = isActiveRoute(pathname, item.href);
          const variant =
            item.label === "Register" ? "primary" : "ghost";

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
            >
              <Button
                variant={variant}
                size="sm"
                className={cn(isActive && "ring-2 ring-primary/30")}
              >
                {item.label}
              </Button>
            </Link>
          );
        })}
        <ThemeToggle />
      </div>
    </div>
  );
}
