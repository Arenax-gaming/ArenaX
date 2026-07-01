// filepath: frontend/src/components/ui/BottomNav.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useDevice } from "@/hooks/useMobile";
import { Gamepad2, Trophy, User, Home } from "lucide-react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

// Navigation items with icons
const NAV_ITEMS = [
  {
    label: "Home",
    href: "/",
    icon: (active: boolean) => (
      <Home className={cn("w-6 h-6", active && "fill-primary")} />
    ),
  },
  {
    label: "Play",
    href: "/play",
    icon: (active: boolean) => (
      <Gamepad2 className={cn("w-6 h-6", active && "fill-primary")} />
    ),
  },
  {
    label: "Tournaments",
    href: "/tournaments",
    icon: (active: boolean) => (
      <Trophy className={cn("w-6 h-6", active && "fill-primary")} />
    ),
  },
  {
    label: "Leaderboard",
    href: "/leaderboard",
    icon: (active: boolean) => (
      <Trophy className={cn("w-6 h-6", active && "fill-primary")} />
    ),
  },
  {
    label: "Profile",
    href: "/profile",
    icon: (active: boolean) => (
      <User className={cn("w-6 h-6", active && "fill-primary")} />
    ),
  },
];

interface BottomNavProps {
  className?: string;
}

export function BottomNav({ className }: BottomNavProps) {
  const pathname = usePathname();
  const { isMobile, safeAreaInsets } = useDevice();
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const prefersReducedMotion = useReducedMotion();

  // Hide on scroll down, show on scroll up
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
        // Scrolling down - hide
        setIsVisible(false);
      } else {
        // Scrolling up - show
        setIsVisible(true);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Don't render on desktop
  if (!isMobile) {
    return null;
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.nav
          className={cn(
            "fixed bottom-0 left-0 right-0 z-40",
            "bg-background/95 backdrop-blur-lg",
            "border-t border-border",
            className,
          )}
          initial={prefersReducedMotion ? { y: 0 } : { y: "100%" }}
          animate={prefersReducedMotion ? { y: 0 } : { y: 0 }}
          exit={prefersReducedMotion ? { y: 0 } : { y: "100%" }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { type: "spring", damping: 25, stiffness: 300 }
          }
          style={{
            paddingBottom: `${safeAreaInsets.bottom}px`,
          }}
        >
          <div className="flex items-center justify-around h-16">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex flex-col items-center justify-center",
                    "flex-1 h-full py-2 gap-0.5",
                    "transition-colors duration-200",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  {/* Shared sliding top-border indicator */}
                  {isActive && (
                    <motion.div
                      className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary"
                      layoutId={prefersReducedMotion ? undefined : "activeBar"}
                      transition={
                        prefersReducedMotion
                          ? { duration: 0 }
                          : { type: "spring", damping: 30, stiffness: 400 }
                      }
                    />
                  )}

                  {/* Active background pill */}
                  {isActive && (
                    <motion.div
                      className="absolute inset-x-2 inset-y-1 rounded-xl bg-primary/10"
                      layoutId={prefersReducedMotion ? undefined : "activeBg"}
                      transition={
                        prefersReducedMotion
                          ? { duration: 0 }
                          : { type: "spring", damping: 30, stiffness: 400 }
                      }
                    />
                  )}

                  <div className="relative z-10">
                    {item.icon(isActive)}
                  </div>
                  <span className="relative z-10 text-xs font-medium">
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

export default BottomNav;
