"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  passwordResetRequestSchema,
  passwordResetSchema,
  type PasswordResetRequestFormData,
  type PasswordResetFormData,
} from "@/lib/validations/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/Form";

interface PasswordResetFormProps {
  className?: string;
}

export function PasswordResetForm({ className }: PasswordResetFormProps) {
  const [step, setStep] = useState<"request" | "reset">("request");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [success, setSuccess] = useState(false);

  // ── Step 1: request reset link ─────────────────────────────────────────────
  const requestForm = useForm<PasswordResetRequestFormData>({
    resolver: zodResolver(passwordResetRequestSchema),
    defaultValues: { email: "" },
  });

  // ── Step 2: set new password ───────────────────────────────────────────────
  const resetForm = useForm<PasswordResetFormData>({
    resolver: zodResolver(passwordResetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const handleRequestReset = async (data: PasswordResetRequestFormData) => {
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setSubmittedEmail(data.email);
      setSuccess(true);
    } catch {
      requestForm.setError("root", {
        message: "Failed to send reset email. Please try again.",
      });
    }
  };

  const handleResetPassword = async (_data: PasswordResetFormData) => {
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setStep("request");
      setSuccess(true);
      resetForm.reset();
    } catch {
      resetForm.setError("root", {
        message: "Failed to reset password. Please try again.",
      });
    }
  };

  if (step === "request" && success) {
    return (
      <div className={cn("text-center py-8", className)}>
        <CheckCircle className="h-16 w-16 text-success mx-auto mb-4" aria-hidden="true" />
        <h2 className="text-xl font-bold text-foreground mb-2">Check your email</h2>
        <p className="text-muted-foreground mb-6">
          We&apos;ve sent a password reset link to{" "}
          <span className="font-medium">{submittedEmail}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Didn&apos;t receive the email? Check your spam folder or{" "}
          <button
            onClick={() => setSuccess(false)}
            className="text-primary hover:text-info font-medium"
          >
            try again
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      {step === "request" ? (
        <Form {...requestForm}>
          <form
            onSubmit={requestForm.handleSubmit(handleRequestReset)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={requestForm.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email address</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="you@example.com"
                      error={!!requestForm.formState.errors.email}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {requestForm.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {requestForm.formState.errors.root.message}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={requestForm.formState.isSubmitting}
            >
              Send reset link
            </Button>
          </form>
        </Form>
      ) : (
        <Form {...resetForm}>
          <form
            onSubmit={resetForm.handleSubmit(handleResetPassword)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={resetForm.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      placeholder="••••••••"
                      error={!!resetForm.formState.errors.password}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={resetForm.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      placeholder="••••••••"
                      error={!!resetForm.formState.errors.confirmPassword}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {resetForm.formState.errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {resetForm.formState.errors.root.message}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={resetForm.formState.isSubmitting}
            >
              Reset password
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
}
