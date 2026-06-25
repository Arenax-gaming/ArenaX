"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

/**
 * Forgot Password — UI stub.
 * Backend integration and email flow can be added later.
 */
export default function ForgotPasswordPage() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Forgot password?
          </CardTitle>
          <CardDescription className="text-center">
            Enter your email and we&apos;ll send you a link to reset your password. This feature is coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            For now, please contact support or try signing in with your existing password.
          </p>
        </CardContent>
        <CardFooter className="flex justify-center gap-4 flex-wrap">
          <Link href="/login">
            <Button variant="outline">Back to sign in</Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
