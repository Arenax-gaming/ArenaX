import { Navbar } from "@/components/layout/Navbar";
import { MobileHeaderActions } from "@/components/layout/MobileHeaderActions";
import { Logo } from "@/components/common/Logo";
import { ToastContainer } from "@/components/notifications/Toast";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <Logo className="md:hidden" />
          <Navbar />
          <MobileHeaderActions />
        </div>
      </header>
      <main className="container py-6 md:py-10">{children}</main>
      <ToastContainer />
    </div>
  );
}
