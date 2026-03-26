import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service - ArenaX",
  description: "ArenaX Terms of Service. Please read these terms carefully before using our platform.",
};

export default function TermsPage() {
  return (
    <div className="container py-8 md:py-12 lg:py-24">
      <div className="mx-auto max-w-[64rem]">
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl mb-8">
          Terms of <span className="text-primary">Service</span>
        </h1>
        
        <div className="prose prose-muted dark:prose-invert max-w-none">
          <p className="text-lg text-muted-foreground mb-8">
            Last updated: February 2026
          </p>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground mb-4">
              By accessing and using ArenaX (&quot;the Platform&quot;), you accept and agree to be bound 
              by the terms and provision of this agreement. Additionally, when using ArenaX services, 
              you shall be subject to any posted guidelines or rules applicable to such services.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">2. Description of Service</h2>
            <p className="text-muted-foreground mb-4">
              ArenaX is a decentralized competitive gaming platform that allows users to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Register and create user accounts</li>
              <li>Participate in competitive gaming tournaments</li>
              <li>Win prize money in various cryptocurrencies and fiat currencies</li>
              <li>Connect Stellar wallets for deposits and withdrawals</li>
              <li>View match history and tournament statistics</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">3. User Eligibility</h2>
            <p className="text-muted-foreground mb-4">
              You must be at least 18 years of age to use ArenaX. By using this Platform, 
              you represent and warrant that you are at least 18 years of age and that you 
              have the legal capacity to enter into this agreement.
            </p>
            <p className="text-muted-foreground mb-4">
              Some features of ArenaX may be subject to additional eligibility requirements 
              based on your jurisdiction. It is your responsibility to ensure that you are 
              legally permitted to participate in competitive gaming and gambling activities 
              in your location.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">4. Account Registration</h2>
            <p className="text-muted-foreground mb-4">
              To participate in tournaments, you must create an ArenaX account. You agree to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Provide accurate and complete registration information</li>
              <li>Maintain the security of your account credentials</li>
              <li>Promptly update any changes to your account information</li>
              <li>Accept responsibility for all activities under your account</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">5. Tournament Rules</h2>
            <p className="text-muted-foreground mb-4">
              All tournaments on ArenaX are governed by specific rules that participants must 
              follow. Key rules include:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>All matches must be played according to the official game rules</li>
              <li>Results must be reported honestly through our verification system</li>
              <li>Any form of cheating, hacking, or exploiting is strictly prohibited</li>
              <li>Smurfing (playing on alternate accounts) is not permitted</li>
              <li>Disputes must be filed within 24 hours of match completion</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">6. Anti-Cheat Policy</h2>
            <p className="text-muted-foreground mb-4">
              ArenaX employs advanced anti-cheat systems to ensure fair competition. Users 
              found violating our anti-cheat policy will be subject to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Immediate account suspension</li>
              <li>Forfeiture of all tournament winnings</li>
              <li>Permanent ban from the platform</li>
              <li>Potential legal action for severe violations</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">7. Payments and Prizes</h2>
            <p className="text-muted-foreground mb-4">
              All prize payments are processed through the Stellar blockchain or other supported 
              payment methods. By participating in tournaments, you agree to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Provide valid payment information for withdrawals</li>
              <li>Pay any applicable entry fees before tournament participation</li>
              <li>Accept that prize payments may take 3-5 business days to process</li>
              <li>Comply with all applicable tax laws regarding winnings</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">8. Prohibited Activities</h2>
            <p className="text-muted-foreground mb-4">
              The following activities are strictly prohibited on ArenaX:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Using unauthorized software, bots, or cheats</li>
              <li>Colluding with other players to fix match outcomes</li>
              <li>Creating multiple accounts to circumvent restrictions</li>
              <li>Engaging in harassment, hate speech, or abusive behavior</li>
              <li>Attempting to hack or compromise the Platform</li>
              <li>Using the Platform for any illegal purpose</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">9. Limitation of Liability</h2>
            <p className="text-muted-foreground mb-4">
              ArenaX shall not be liable for any indirect, incidental, special, consequential, 
              or punitive damages, including without limitation, loss of profits, data, use, 
              goodwill, or other intangible losses resulting from:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Your use or inability to use the Platform</li>
              <li>Any unauthorized access to or use of our servers</li>
              <li>Any interruption or cessation of transmission to or from the Platform</li>
              <li>Any bugs, viruses, or similar harmful material</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">10. Modification of Terms</h2>
            <p className="text-muted-foreground mb-4">
              ArenaX reserves the right to modify these terms at any time. We will provide 
              notice of material changes by posting the updated terms on the Platform and 
              updating the &quot;Last Updated&quot; date. Your continued use of the Platform after 
              such modifications constitutes your acceptance of the new terms.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">11. Contact Information</h2>
            <p className="text-muted-foreground mb-4">
              If you have any questions about these Terms of Service, please contact us at:
            </p>
            <p className="text-muted-foreground">
              Email: legal@arenax.io<br />
              Or visit our <Link href="/contact" className="text-primary hover:underline">Contact page</Link> for support.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
