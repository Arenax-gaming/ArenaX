import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy - ArenaX",
  description: "ArenaX Privacy Policy. Learn how we collect, use, and protect your personal information.",
};

export default function PrivacyPage() {
  return (
    <div className="container py-8 md:py-12 lg:py-24">
      <div className="mx-auto max-w-[64rem]">
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl mb-8">
          Privacy <span className="text-primary">Policy</span>
        </h1>
        
        <div className="prose prose-muted dark:prose-invert max-w-none">
          <p className="text-lg text-muted-foreground mb-8">
            Last updated: February 2026
          </p>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">1. Introduction</h2>
            <p className="text-muted-foreground mb-4">
              At ArenaX, we take your privacy seriously. This Privacy Policy explains how we 
              collect, use, disclose, and safeguard your information when you use our 
              decentralized competitive gaming platform. Please read this privacy policy 
              carefully.
            </p>
            <p className="text-muted-foreground mb-4">
              By accessing or using ArenaX, you agree to this Privacy Policy. If you do not 
              agree with the terms of this policy, please do not access the Platform.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">2. Information We Collect</h2>
            
            <h3 className="font-heading text-xl font-bold mb-3">Personal Information</h3>
            <p className="text-muted-foreground mb-4">
              We may collect personal information that you voluntarily provide when you:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Register for an account</li>
              <li>Participate in tournaments</li>
              <li>Connect a cryptocurrency wallet</li>
              <li>Submit a support request</li>
              <li>Subscribe to our newsletter</li>
            </ul>
            <p className="text-muted-foreground mb-4">
              This information may include:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Name and email address</li>
              <li>Wallet addresses (Stellar and other blockchains)</li>
              <li>Profile information and username</li>
              <li>Payment and transaction history</li>
              <li>Communication preferences</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">3. Blockchain Data</h2>
            <p className="text-muted-foreground mb-4">
              As a blockchain-based platform, certain information is recorded publicly on the 
              blockchain:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Wallet addresses</li>
              <li>Transaction history (deposits, withdrawals, prize payouts)</li>
              <li>Tournament participation and results</li>
              <li>Smart contract interactions</li>
            </ul>
            <p className="text-muted-foreground mb-4 mt-4">
              This information is pseudonymous and cannot be reverse-engineered to identify 
              you without additional information. However, once you connect your identity to 
              a wallet address, all associated blockchain activity becomes linked to you.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">4. How We Use Your Information</h2>
            <p className="text-muted-foreground mb-4">
              We use the information we collect to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Provide, maintain, and improve our services</li>
              <li>Process tournament entries and prize distributions</li>
              <li>Verify your identity and prevent fraud</li>
              <li>Communicate with you about updates and support</li>
              <li>Enforce our Terms of Service</li>
              <li>Comply with legal obligations</li>
              <li>Analyze usage patterns to enhance user experience</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">5. Data Sharing and Disclosure</h2>
            <p className="text-muted-foreground mb-4">
              We may share your information with:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li><strong>Service Providers:</strong> Third-party vendors who assist in platform operations</li>
              <li><strong>Game Developers:</strong> For anti-cheat verification and tournament coordination</li>
              <li><strong>Legal Authorities:</strong> When required by law or to protect rights and safety</li>
              <li><strong>Business Partners:</strong> With your consent for promotional offers</li>
            </ul>
            <p className="text-muted-foreground mb-4 mt-4">
              We do NOT sell your personal information to third parties.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">6. Data Security</h2>
            <p className="text-muted-foreground mb-4">
              We implement appropriate technical and organizational measures to protect your 
              personal information, including:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Encryption of sensitive data in transit and at rest</li>
              <li>Regular security audits and vulnerability assessments</li>
              <li>Access controls and authentication requirements</li>
              <li>Secure blockchain transaction verification</li>
            </ul>
            <p className="text-muted-foreground mb-4 mt-4">
              While we strive to protect your information, no method of transmission over 
              the Internet is 100% secure. We cannot guarantee absolute security.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">7. Your Rights</h2>
            <p className="text-muted-foreground mb-4">
              Depending on your location, you may have the following rights:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Correction:</strong> Request correction of inaccurate data</li>
              <li><strong>Deletion:</strong> Request deletion of your personal data</li>
              <li><strong>Portability:</strong> Request your data in a machine-readable format</li>
              <li><strong>Objection:</strong> Object to certain processing activities</li>
            </ul>
            <p className="text-muted-foreground mb-4 mt-4">
              To exercise these rights, please contact us through our <Link href="/contact" className="text-primary hover:underline">Contact page</Link>.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">8. Cookies and Tracking</h2>
            <p className="text-muted-foreground mb-4">
              We use cookies and similar tracking technologies to:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
              <li>Keep you logged in</li>
              <li>Understand how you use our Platform</li>
              <li>Remember your preferences</li>
              <li>Improve our services</li>
            </ul>
            <p className="text-muted-foreground mb-4 mt-4">
              You can control cookies through your browser settings. However, disabling 
              cookies may affect your ability to use certain features of the Platform.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">9. Data Retention</h2>
            <p className="text-muted-foreground mb-4">
              We retain your personal information for as long as your account is active or 
              as needed to provide you services. Blockchain data, by its nature, is 
              permanent and cannot be deleted. However, you can disconnect your wallet 
              from your account to reduce on-chain linkage.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">10. Children's Privacy</h2>
            <p className="text-muted-foreground mb-4">
              ArenaX is not intended for children under 18. We do not knowingly collect 
              personal information from children under 18. If you become aware that a child 
              has provided us with personal information, please contact us immediately.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">11. Third-Party Links</h2>
            <p className="text-muted-foreground mb-4">
              Our Platform may contain links to third-party websites, services, or applications. 
              We are not responsible for the privacy practices of these third parties. We 
              encourage you to review the privacy policies of any third-party sites you visit.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">12. International Data Transfers</h2>
            <p className="text-muted-foreground mb-4">
              Your information may be transferred to and processed in countries other than 
              your country of residence. These countries may have different data protection 
              laws. By using ArenaX, you consent to such transfers.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">13. Changes to This Policy</h2>
            <p className="text-muted-foreground mb-4">
              We may update this Privacy Policy from time to time. We will notify you of 
              any changes by posting the new Privacy Policy on this page and updating the 
              "Last Updated" date. You are advised to review this Privacy Policy periodically 
              for any changes.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="font-heading text-2xl font-bold mb-4">14. Contact Information</h2>
            <p className="text-muted-foreground mb-4">
              If you have any questions about this Privacy Policy, please contact us at:
            </p>
            <p className="text-muted-foreground">
              Email: privacy@arenax.io<br />
              Or visit our <Link href="/contact" className="text-primary hover:underline">Contact page</Link> for support.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
