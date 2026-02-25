import { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Mail, MessageSquare } from "lucide-react";
import { ContactForm } from "./ContactForm";
import { FAQSection } from "./FAQSection";

export const metadata: Metadata = {
  title: "Contact & Support - ArenaX",
  description: "Get in touch with the ArenaX team. We're here to help with any questions or concerns.",
};

export default function ContactPage() {
  return (
    <div className="container py-8 md:py-12 lg:py-24">
      {/* Hero Section */}
      <section className="mx-auto max-w-[64rem] text-center mb-16">
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl mb-6">
          Contact <span className="text-primary">&</span> Support
        </h1>
        <p className="text-xl text-muted-foreground max-w-[42rem] mx-auto">
          Have questions? We&apos;re here to help. Reach out to our team or check our FAQs.
        </p>
      </section>

      <div className="mx-auto max-w-[64rem]">
        <div className="grid gap-12 lg:grid-cols-2">
          {/* Contact Form */}
          <section>
            <ContactForm/>
          </section>

          {/* FAQ Section */}
          <section>
            <FAQSection/>

            {/* Contact Info */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Card className="bg-muted/50 border-none">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Mail className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Email Us</p>
                    <p className="text-sm text-muted-foreground">support@arenax.io</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-muted/50 border-none">
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <MessageSquare className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Join Discord</p>
                    <p className="text-sm text-muted-foreground">discord.gg/arenax</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
