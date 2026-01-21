import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/Button";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <div className="mr-4 hidden md:flex">
            <Link href="/" className="mr-6 flex items-center space-x-2">
              <span className="hidden font-bold sm:inline-block">ArenaX</span>
            </Link>
            <nav className="flex items-center space-x-6 text-sm font-medium">
              <Link
                href="/tournaments"
                className="transition-colors hover:text-foreground/80 text-foreground/60"
              >
                Tournaments
              </Link>
              <Link
                href="/uikit"
                className="transition-colors hover:text-foreground/80 text-foreground/60"
              >
                UI Kit
              </Link>
            </nav>
          </div>
          <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
            <div className="w-full flex-1 md:w-auto md:flex-none">
              {/* Search placeholder */}
            </div>
            <nav className="flex items-center">
              <ThemeToggle />
            </nav>
          </div>
        </div>
      </header>
      <main className="container py-6 md:py-10">{children}</main>
    </div>
  );
}
