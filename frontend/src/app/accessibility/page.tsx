import React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export default function AccessibilityPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-10">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Accessibility Statement</h1>
        <p className="text-muted-foreground">
          ArenaX is committed to ensuring digital accessibility for people with disabilities. We are
          continuously improving the user experience for everyone, and applying the relevant
          accessibility standards.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conformance Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>
            The Web Content Accessibility Guidelines (WCAG) defines requirements for designers and
            developers to improve accessibility for people with disabilities. It defines three levels
            of conformance: Level A, Level AA, and Level AAA.
          </p>
          <p>
            ArenaX is fully conformant with WCAG 2.1 level AA. Fully conformant means that the content
            fully meets all the WCAG success criteria.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accessibility Features</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 list-disc pl-5">
            <li>Keyboard navigation support</li>
            <li>Screen reader compatibility</li>
            <li>Text resizing up to 200%</li>
            <li>High contrast mode</li>
            <li>Color blind modes</li>
            <li>Reduced motion option</li>
            <li>ARIA labels and roles</li>
            <li>Skip to main content link</li>
            <li>Accessible form controls</li>
            <li>Descriptive link text</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feedback</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            We welcome your feedback on the accessibility of ArenaX. Please let us know if you
            encounter accessibility barriers:
          </p>
          <Link href="/contact" className="text-primary hover:underline">
            Contact Us
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
