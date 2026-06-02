"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/contexts/NotificationContext";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import { registerSchema, type RegisterFormData } from "@/lib/validations/auth";
import { PasswordStrengthIndicator } from "@/components/auth/PasswordStrengthIndicator";

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerUser, loading, error, clearError, user } = useAuth();
  const { addToast } = useNotifications();
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof RegisterFormData, string>>>({});

  const usernameStatus = useUsernameAvailability(formData.username);

  useEffect(() => {
    if (error) {
      addToast({
        type: "error",
        title: "Registration failed",
        message: error,
        duration: 6000,
      });
      clearError();
    }
  }, [error, addToast, clearError]);

  useEffect(() => {
    if (user) {
      router.replace("/auth/verify-email");
    }
  }, [user, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.id]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const result = registerSchema.safeParse(formData);
    if (!result.success) {
      const errors: Partial<Record<keyof RegisterFormData, string>> = {};
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof RegisterFormData;
        if (path && !errors[path]) errors[path] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }

    if (usernameStatus === "unavailable") {
      setFieldErrors({ username: "This username is already taken" });
      return;
    }

    if (usernameStatus === "checking") {
      setFieldErrors({ username: "Please wait while we check username availability" });
      return;
    }

    if (usernameStatus === "error") {
      setFieldErrors({ username: "Could not verify username availability. Please try again." });
      return;
    }

    await registerUser({
      username: result.data.username,
      email: result.data.email,
      password: result.data.password,
      confirmPassword: result.data.confirmPassword,
    });
  };

  const isSubmitDisabled =
    loading ||
    usernameStatus === "checking" ||
    usernameStatus === "unavailable";

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Create an account
          </CardTitle>
          <CardDescription className="text-center">
            Enter your details below to create your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Username
              </label>
              <div className="relative">
                <Input
                  id="username"
                  type="text"
                  placeholder="ArenaMaster"
                  value={formData.username}
                  onChange={handleChange}
                  disabled={loading}
                  error={!!fieldErrors.username || usernameStatus === "unavailable"}
                  autoComplete="username"
                  aria-invalid={!!fieldErrors.username || usernameStatus === "unavailable"}
                  aria-describedby="username-hint username-status"
                  className="pr-8"
                />
                {/* Availability indicator icon */}
                {usernameStatus === "checking" && (
                  <Loader2
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                {usernameStatus === "available" && (
                  <CheckCircle2
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500"
                    aria-hidden="true"
                  />
                )}
                {usernameStatus === "unavailable" && (
                  <XCircle
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive"
                    aria-hidden="true"
                  />
                )}
              </div>
              <p id="username-hint" className="text-xs text-muted-foreground">
                3–20 characters, letters and numbers only
              </p>
              {/* Availability status message */}
              <p
                id="username-status"
                aria-live="polite"
                className={
                  usernameStatus === "available"
                    ? "text-xs text-green-500"
                    : usernameStatus === "unavailable"
                    ? "text-xs text-destructive"
                    : usernameStatus === "error"
                    ? "text-xs text-destructive"
                    : "sr-only"
                }
              >
                {usernameStatus === "available" && "Username is available"}
                {usernameStatus === "unavailable" && "Username is already taken"}
                {usernameStatus === "error" && "Could not check availability"}
                {usernameStatus === "checking" && "Checking availability…"}
              </p>
              {fieldErrors.username && (
                <p className="text-sm text-destructive" role="alert">
                  {fieldErrors.username}
                </p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                value={formData.email}
                onChange={handleChange}
                disabled={loading}
                error={!!fieldErrors.email}
                autoComplete="email"
                aria-invalid={!!fieldErrors.email}
              />
              {fieldErrors.email && (
                <p className="text-sm text-destructive" role="alert">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                disabled={loading}
                error={!!fieldErrors.password}
                autoComplete="new-password"
                aria-invalid={!!fieldErrors.password}
              />
              {fieldErrors.password && (
                <p className="text-sm text-destructive" role="alert">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Confirm Password
              </label>
              <Input
                id="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                disabled={loading}
                error={!!fieldErrors.confirmPassword}
                autoComplete="new-password"
                aria-invalid={!!fieldErrors.confirmPassword}
              />
              {fieldErrors.confirmPassword && (
                <p className="text-sm text-destructive" role="alert">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>

            <FormError message={error ?? ""} />

            <Button
              className="w-full"
              type="submit"
              disabled={isSubmitDisabled}
              loading={loading}
            >
              Create account
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <div className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
