"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Menu, Download } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

// Strong typing for install prompt event
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [visible, setVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const pathname = usePathname();

  // Handle PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Hide/show header on scroll
  useEffect(() => {
    const controlHeader = () => {
      if (window.scrollY > lastScrollY && window.scrollY > 80) {
        setVisible(false);
      } else {
        setVisible(true);
      }
      setLastScrollY(window.scrollY);
    };

    window.addEventListener("scroll", controlHeader);
    return () => window.removeEventListener("scroll", controlHeader);
  }, [lastScrollY]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log("PWA install:", outcome);
    setDeferredPrompt(null);
    setCanInstall(false);
  };

  const NavLink = ({ href, label }: { href: string; label: string }) => (
    <Link href={href} onClick={() => setMenuOpen(false)}>
      <Button
        variant="ghost"
        className={`text-white hover:text-green-400 transition-colors ${
          pathname === href ? "text-green-500 font-semibold" : ""
        }`}
      >
        {label}
      </Button>
    </Link>
  );

  return (
    <>
      <AnimatePresence>
        <motion.header
          key="header"
          initial={{ y: 0 }}
          animate={{ y: visible ? 0 : -90 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="fixed top-0 left-0 w-full border-b border-green-500/30 bg-black/90 backdrop-blur-md z-50"
          style={{ height: "80px" }}
        >
          <nav className="container mx-auto grid grid-cols-3 items-center py-4 px-4">
            {/* Logo */}
            <div className="col-start-1 flex items-center">
              <Link href="/">
                <div className="flex items-center gap-2">
                  <Image
                    src="/icon-192x192.png"
                    alt="ArenaX Logo"
                    width={36}
                    height={36}
                  />
                  <span className="text-xl md:text-2xl font-bold text-green-500">
                    ArenaX
                  </span>
                </div>
              </Link>
            </div>

            {/* Center Nav (desktop) */}
            <div className="col-start-2 flex justify-center">
              <div className="hidden md:flex items-center gap-4">
                <NavLink href="/tournaments" label="Tournaments" />
                <NavLink href="/pricing" label="Pricing" />
                <NavLink href="/about" label="About" />
              </div>
            </div>

            {/* Right Area */}
            <div className="col-start-3 flex items-center justify-end gap-3">
              {/* Desktop Actions */}
              <div className="hidden md:flex items-center gap-3">
                {canInstall && (
                  <Button
                    onClick={handleInstall}
                    className="bg-zinc-800 hover:bg-zinc-700 text-green-400 border border-green-500/40"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Install
                  </Button>
                )}
                <Link href="/signup">
                  <Button className="bg-green-500 hover:bg-green-600 text-black font-semibold">
                    Get Started
                  </Button>
                </Link>
              </div>

              {/* Mobile Menu Toggle */}
              <button
                className="md:hidden p-2 text-green-500"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="Toggle menu"
                aria-expanded={menuOpen}
                aria-controls="mobile-menu"
              >
                <Menu className="h-6 w-6" />
              </button>
            </div>
          </nav>

          {/* Mobile Menu */}
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                id="mobile-menu"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="md:hidden flex flex-col items-center text-center px-4 pb-4 gap-2 border-t border-green-500/30 bg-black/90 backdrop-blur-md overflow-hidden"
              >
                <NavLink href="/tournaments" label="Tournaments" />
                <NavLink href="/pricing" label="Pricing" />
                <NavLink href="/about" label="About" />

                {canInstall && (
                  <Button
                    onClick={handleInstall}
                    className="bg-zinc-800 hover:bg-zinc-700 text-green-400 border border-green-500/40"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Install
                  </Button>
                )}
                <Link href="/signup" className="w-full flex justify-center">
                  <Button className="bg-green-500 hover:bg-green-600 text-black font-semibold w-3/4">
                    Get Started
                  </Button>
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>
      </AnimatePresence>

      {/* Offset main content so it’s not hidden behind header */}
      <div className="pt-[80px]" />
    </>
  );
}
