"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { authNav, mainNav } from "@/lib/routes";
import { ProtectedLink } from "@/components/navigation/ProtectedLink";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/common/Logo";

const isActiveRoute = (pathname: string, href: string) =>
  pathname === href || (href !== "/" && pathname.startsWith(href));

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const authItems = loading ? [] : user ? [] : authNav.unauthenticated;

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="sm"
        className="px-2"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle Menu"
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </Button>

      {isOpen && (
        <div className="fixed inset-0 top-14 z-50 grid h-[calc(100vh-3.5rem)] grid-flow-row auto-rows-max overflow-auto bg-background p-6 pb-32 animate-in slide-in-from-bottom-80 md:hidden">
          <div className="relative z-20 grid gap-6 rounded-md border bg-popover p-4 text-popover-foreground shadow-md">
            <Logo onClick={() => setIsOpen(false)} />
            <nav className="grid grid-flow-row auto-rows-max text-sm">
              {mainNav.map((item) => {
                const isActive = isActiveRoute(pathname, item.href);
                const linkClass = cn(
                  "flex w-full items-center rounded-md p-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                );

                if (item.href === "/wallet") {
                  return (
                    <ProtectedLink
                      key={item.href}
                      href={item.href}
                      className={linkClass}
                      fallback={
                        <Link
                          href={`/login?redirect=${encodeURIComponent(pathname || "/")}`}
                          className={linkClass}
                          onClick={() => setIsOpen(false)}
                        >
                          {item.label}
                        </Link>
                      }
                    >
                      <span onClick={() => setIsOpen(false)}>{item.label}</span>
                    </ProtectedLink>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={linkClass}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setIsOpen(false)}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-4 flex flex-col gap-2">
              {user ? (
                <>
                  <Link
                    href="/profile"
                    className={cn(
                      "flex w-full items-center rounded-md p-2 text-sm font-medium transition-colors",
                      isActiveRoute(pathname, "/profile")
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                    onClick={() => setIsOpen(false)}
                  >
                    Profile
                  </Link>
                  <Link
                    href="/wallet"
                    className={cn(
                      "flex w-full items-center rounded-md p-2 text-sm font-medium transition-colors",
                      isActiveRoute(pathname, "/wallet")
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                    onClick={() => setIsOpen(false)}
                  >
                    Wallet
                  </Link>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md p-2 text-sm font-medium text-destructive hover:bg-muted/60 transition-colors text-left"
                    onClick={() => {
                      setIsOpen(false);
                      logout();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    Log out
                  </button>
                </>
              ) : (
                authItems.map((item) => {
                  const isActive = isActiveRoute(pathname, item.href);
                  const variant =
                    item.label === "Register" ? "primary" : "ghost";

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsOpen(false)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Button
                        variant={variant}
                        className={cn(
                          "w-full justify-start",
                          isActive && "ring-2 ring-primary/30"
                        )}
                      >
                        {item.label}
                      </Button>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
