"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Menu, Download } from "lucide-react";
import Image from "next/image";

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [canInstall, setCanInstall] = useState(false);

  // Handle PWA install prompt
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log("PWA install:", outcome);
    setDeferredPrompt(null);
    setCanInstall(false);
  };

  return (
    <header className="w-full border-b border-green-500/30 bg-black">
      <nav className="container mx-auto flex items-center justify-between py-4 px-4">
        {/* Logo */}
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

        {/* Desktop Nav */}
        <div className="hidden md:flex gap-4">
          <Button variant="ghost" className="text-white hover:text-green-400">
            Features
          </Button>
          <Button variant="ghost" className="text-white hover:text-green-400">
            Pricing
          </Button>
          <Button variant="ghost" className="text-white hover:text-green-400">
            About
          </Button>
          {canInstall && (
            <Button
              onClick={handleInstall}
              className="bg-zinc-800 hover:bg-zinc-700 text-green-400 border border-green-500/40"
            >
              <Download className="h-4 w-4 mr-2" />
              Install
            </Button>
          )}
          <Button className="bg-green-500 hover:bg-green-600 text-black font-semibold">
            Get Started
          </Button>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden p-2 text-green-500"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Menu className="h-6 w-6" />
        </button>
      </nav>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden flex flex-col px-4 pb-4 gap-2 border-t border-green-500/30 bg-black">
          <Button variant="ghost" className="text-white hover:text-green-400">
            Features
          </Button>
          <Button variant="ghost" className="text-white hover:text-green-400">
            Pricing
          </Button>
          <Button variant="ghost" className="text-white hover:text-green-400">
            About
          </Button>
          {canInstall && (
            <Button
              onClick={handleInstall}
              className="bg-zinc-800 hover:bg-zinc-700 text-green-400 border border-green-500/40"
            >
              <Download className="h-4 w-4 mr-2" />
              Install
            </Button>
          )}
          <Button className="bg-green-500 hover:bg-green-600 text-black font-semibold">
            Get Started
          </Button>
        </div>
      )}
    </header>
  );
}
