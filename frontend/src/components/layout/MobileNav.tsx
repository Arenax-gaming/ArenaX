"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Menu, X, LogOut, Wallet, User, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { authNav, mainNav } from "@/lib/routes";
import { ProtectedLink } from "@/components/navigation/ProtectedLink";
import { useAuth } from "@/hooks/useAuth";
import { Logo } from "@/components/common/Logo";
import { motion, AnimatePresence } from "framer-motion";

const isActiveRoute = (pathname: string, href: string) =>
  pathname === href || (href !== "/" && pathname.startsWith(href));

// Animation variants for drawer slide-in from left
const drawerVariants = {
  hidden: {
    x: "-100%",
    opacity: 0,
  },
  visible: {
    x: 0,
    opacity: 1,
    transition: {
      type: "spring",
      damping: 25,
      stiffness: 300,
      mass: 0.8,
    },
  },
  exit: {
    x: "-100%",
    opacity: 0,
    transition: {
      duration: 0.2,
      ease: "easeIn",
    },
  },
};

// Backdrop animation variants
const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();

  // Close drawer on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Handle ESC key to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const authItems = loading ? [] : user ? [] : authNav.unauthenticated;

  // Mock wallet balance - in production, this would come from a wallet hook
  const walletBalance = user ? "0.00 XLM" : null;

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="sm"
        className="px-2 relative"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? "Close Menu" : "Open Menu"}
        aria-expanded={isOpen}
        aria-controls="mobile-navigation-drawer"
      >
        {isOpen ? (
          <X className="h-6 w-6" />
        ) : (
          <Menu className="h-6 w-6" />
        )}
      </Button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop overlay with blur effect */}
            <motion.div
              className="fixed inset-0 top-14 z-40 bg-background/80 backdrop-blur-sm"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={backdropVariants}
              transition={{ duration: 0.2 }}
              onClick={() => setIsOpen(false)}
              aria-hidden="true"
            />

            {/* Slide-in drawer from left */}
            <motion.aside
              id="mobile-navigation-drawer"
              className="fixed left-0 top-14 z-50 h-[calc(100vh-3.5rem)] w-[280px] max-w-[85vw] overflow-y-auto bg-background border-r border-border"
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={drawerVariants}
              role="dialog"
              aria-modal="true"
              aria-label="Mobile navigation"
            >
              <div className="flex flex-col h-full">
                {/* User profile section */}
                {user && (
                  <div className="p-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-6 w-6 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {user.email || "User"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {user.id.slice(0, 8)}...
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>

                    {/* Wallet balance section */}
                    {walletBalance && (
                      <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/50 p-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{walletBalance}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Main navigation */}
                <nav className="flex-1 p-4">
                  <div className="grid gap-1">
                    {mainNav.map((item) => {
                      const isActive = isActiveRoute(pathname, item.href);
                      const linkClass = cn(
                        "flex w-full items-center justify-between rounded-md p-3 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
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
                                <ChevronRight className="h-4 w-4 opacity-50" />
                              </Link>
                            }
                          >
                            <span
                              className="flex items-center justify-between w-full"
                              onClick={() => setIsOpen(false)}
                            >
                              {item.label}
                              <ChevronRight className="h-4 w-4 opacity-50" />
                            </span>
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
                          <ChevronRight className="h-4 w-4 opacity-50" />
                        </Link>
                      );
                    })}
                  </div>
                </nav>

                {/* Auth section */}
                <div className="p-4 border-t border-border">
                  {user ? (
                    <div className="grid gap-2">
                      <Link
                        href="/profile"
                        className={cn(
                          "flex w-full items-center justify-between rounded-md p-3 text-sm font-medium transition-colors",
                          isActiveRoute(pathname, "/profile")
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                        onClick={() => setIsOpen(false)}
                      >
                        <span className="flex items-center gap-2">
                          <User className="h-4 w-4" />
                          Profile
                        </span>
                        <ChevronRight className="h-4 w-4 opacity-50" />
                      </Link>
                      <Link
                        href="/wallet"
                        className={cn(
                          "flex w-full items-center justify-between rounded-md p-3 text-sm font-medium transition-colors",
                          isActiveRoute(pathname, "/wallet")
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        )}
                        onClick={() => setIsOpen(false)}
                      >
                        <span className="flex items-center gap-2">
                          <Wallet className="h-4 w-4" />
                          Wallet
                        </span>
                        <ChevronRight className="h-4 w-4 opacity-50" />
                      </Link>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md p-3 text-sm font-medium text-destructive hover:bg-muted/60 transition-colors text-left"
                        onClick={() => {
                          setIsOpen(false);
                          logout();
                        }}
                      >
                        <LogOut className="h-4 w-4" />
                        Log out
                      </button>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {authItems.map((item) => {
                        const isActive = isActiveRoute(pathname, item.href);
                        const isRegister = item.label === "Register";

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setIsOpen(false)}
                            aria-current={isActive ? "page" : undefined}
                          >
                            <Button
                              variant={isRegister ? "primary" : "outline"}
                              className={cn(
                                "w-full justify-start",
                                isActive && "ring-2 ring-primary/30"
                              )}
                            >
                              {item.label}
                            </Button>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
