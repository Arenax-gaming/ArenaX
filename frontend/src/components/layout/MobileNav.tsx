"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Menu, X, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);

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
        <div className="fixed inset-0 top-14 z-50 grid h-[calc(100vh-3.5rem)] grid-flow-row auto-rows-max overflow-auto p-6 pb-32 bg-background animate-in slide-in-from-bottom-80 md:hidden">
          <div className="relative z-20 grid gap-6 rounded-md p-4 bg-popover text-popover-foreground shadow-md border">
            <Link
              href="/"
              className="flex items-center space-x-2"
              onClick={() => setIsOpen(false)}
            >
              <Trophy className="h-6 w-6" />
              <span className="font-bold">ArenaX</span>
            </Link>
            <nav className="grid grid-flow-row auto-rows-max text-sm">
              <Link
                href="/tournaments"
                className={cn(
                  "flex w-full items-center rounded-md p-2 text-sm font-medium hover:underline",
                )}
                onClick={() => setIsOpen(false)}
              >
                Tournaments
              </Link>
              <Link
                href="/uikit"
                className={cn(
                  "flex w-full items-center rounded-md p-2 text-sm font-medium hover:underline",
                )}
                onClick={() => setIsOpen(false)}
              >
                UI Kit
              </Link>
            </nav>
            <div className="flex flex-col gap-2 mt-4">
              <Link href="/login" onClick={() => setIsOpen(false)}>
                <Button variant="ghost" className="w-full justify-start">
                  Login
                </Button>
              </Link>
              <Link href="/register" onClick={() => setIsOpen(false)}>
                <Button className="w-full">Sign Up</Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
