import { Button } from "@/components/ui/Button";
import Link from "next/link";

export function CTASection() {
  return (
    <section className="container py-8 md:py-12 lg:py-24">
      <div className="relative rounded-3xl bg-primary px-6 py-16 md:px-12 md:py-24 overflow-hidden">
        <div className="relative z-10 mx-auto flex max-w-[58rem] flex-col items-center gap-4 text-center text-primary-foreground">
          <h2 className="font-heading text-3xl font-bold leading-[1.1] sm:text-3xl md:text-6xl">
            Ready to Start Winning?
          </h2>
          <p className="max-w-[42rem] leading-normal text-primary-foreground/80 sm:text-xl sm:leading-8">
            Join thousands of gamers already competing on ArenaX. Sign up today
            and get your first tournament entry free.
          </p>
          <Link href="/register" className="w-full sm:w-auto">
            <Button
              size="lg"
              variant="secondary"
              className="mt-4 h-12 w-full px-8 text-lg sm:w-auto"
            >
              Create Free Account
            </Button>
          </Link>
        </div>

        {/* Background shapes */}
        <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
      </div>
    </section>
  );
}
