import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/Card";

export default function Home() {
  return (
    <AppLayout>
      <section className="space-y-6 pb-8 pt-6 md:pb-12 md:pt-10 lg:py-32">
        <div className="container flex max-w-[64rem] flex-col items-center gap-4 text-center">
          <h1 className="font-heading text-3xl sm:text-5xl md:text-6xl lg:text-7xl">
            Competitive Gaming Evolved.
          </h1>
          <p className="max-w-[42rem] leading-normal text-muted-foreground sm:text-xl sm:leading-8">
            Join the ultimate platform for esports tournaments. Compete, win,
            and rank up. Now featuring a robust Light & Dark mode system.
          </p>
          <div className="space-x-4">
            <Button size="lg">Get Started</Button>
            <Button variant="outline" size="lg">
              View Tournaments
            </Button>
          </div>
        </div>
      </section>

      <section className="container grid lg:grid-cols-3 gap-6 py-8 md:py-12 lg:py-24">
        <Card>
          <CardHeader>
            <CardTitle>Global Theming</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Fully integrated dark mode with persistent state.</p>
          </CardContent>
          <CardFooter>
            <Button variant="secondary" className="w-full">
              Explore
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Modern Stack</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Built with Next.js 14, TailwindCSS, and Shadcn UI principles.</p>
          </CardContent>
          <CardFooter>
            <Button variant="secondary" className="w-full">
              Explore
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <p>Optimized for speed and accessibility out of the box.</p>
          </CardContent>
          <CardFooter>
            <Button variant="secondary" className="w-full">
              Explore
            </Button>
          </CardFooter>
        </Card>
      </section>
    </AppLayout>
  );
}
