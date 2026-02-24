"use client";

import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, User, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const isActiveRoute = (pathname: string, href: string) =>
  pathname === href || (href !== "/" && pathname.startsWith(href));

export function UserMenu() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!user) return null;

  const initial = user.username?.slice(0, 1).toUpperCase() ?? "?";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center justify-center rounded-full h-8 w-8 text-sm font-medium",
          "bg-primary/10 text-primary border border-primary/20",
          "hover:bg-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2",
          "transition-colors"
        )}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="User menu"
      >
        {user.avatar ? (
          <img
            src={user.avatar}
            alt=""
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span>{initial}</span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-56 rounded-lg border bg-popover text-popover-foreground shadow-md py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200"
          role="menu"
        >
          <div className="px-3 py-2 border-b border-border/50">
            <p className="text-sm font-medium truncate">{user.username}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <Link
            href="/profile"
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <User className="h-4 w-4" />
            Profile
          </Link>
          <Link
            href="/wallet"
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60 transition-colors",
              isActiveRoute(pathname, "/wallet") && "bg-muted/60"
            )}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Wallet className="h-4 w-4" />
            Wallet
          </Link>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60 transition-colors text-left text-destructive focus:bg-muted/60"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
