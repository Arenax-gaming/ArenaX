"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { ValidationMessage } from "@/components/ui/ValidationMessage";
import { FormValidationSummary } from "@/components/ui/FormValidationSummary";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/contexts/NotificationContext";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { useFormFieldValidation } from "@/hooks/useFormFieldValidation";

export default function LoginPage() {
  const router = useRouter();
  const { login, loading, error, clearError, user } = useAuth();
  const { addToast } = useNotifications();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof LoginFormData, string>>>({});
  const [showValidationSummary, setShowValidationSummary] = useState(false);

  // Real-time field validation
  const emailValidation = useFormFieldValidation<LoginFormData>({
    value: email,
    schema: loginSchema,
    fieldName: "email",
    delay: 400,
  });

  const passwordValidation = useFormFieldValidation<LoginFormData>({
    value: password,
    schema: loginSchema,
    fieldName: "password",
    delay: 400,
  });

  // Error toast when auth error is set
  useEffect(() => {
    if (error) {
      addToast({
        type: "error",
        title: "Sign in failed",
        message: error,
        duration: 6000,
      });
      clearError();
    }
  }, [error, addToast, clearError]);

  // Redirect when already logged in
  useEffect(() => {
    if (user) {
      addToast({
        type: "success",
        title: "Welcome back",
        message: `Signed in as ${user.username}`,
        duration: 3000,
      });
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const redirect = params.get("redirect") ?? "/";
      router.replace(redirect);
    }
  }, [user, router, addToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setShowValidationSummary(true);

    const result = loginSchema.safeParse({ email, password, rememberMe });
    if (!result.success) {
      const errors: Partial<Record<keyof LoginFormData, string>> = {};
      result.error.issues.forEach((issue) => {
        const path = issue.path[0] as keyof LoginFormData;
        if (path && !errors[path]) errors[path] = issue.message;
      });
      setFieldErrors(errors);
      return;
    }

    await login({
      email: result.data.email,
      password: result.data.password,
      rememberMe: result.data.rememberMe,
    });
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">
            Welcome back
          </CardTitle>
          <CardDescription className="text-center">
            Enter your email to sign in to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Validation Summary */}
            <FormValidationSummary
              errors={fieldErrors as Record<string, string>}
              isValid={Object.keys(fieldErrors).length === 0}
              isVisible={showValidationSummary}
            />

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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                error={emailValidation.isValid === false || !!fieldErrors.email}
                success={emailValidation.isValid === true}
                autoComplete="email"
                aria-invalid={emailValidation.isValid === false || !!fieldErrors.email}
                aria-describedby={emailValidation.error ? "email-error" : emailValidation.isValid ? "email-success" : undefined}
              />
              <ValidationMessage
                id="email-error"
                message={fieldErrors.email || emailValidation.error}
                state={
                  fieldErrors.email || emailValidation.isValid === false
                    ? "error"
                    : emailValidation.isValid === true
                    ? "success"
                    : "idle"
                }
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-medium text-muted-foreground hover:text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                error={passwordValidation.isValid === false || !!fieldErrors.password}
                success={passwordValidation.isValid === true}
                autoComplete="current-password"
                aria-invalid={passwordValidation.isValid === false || !!fieldErrors.password}
                aria-describedby={passwordValidation.error ? "password-error" : passwordValidation.isValid ? "password-success" : undefined}
              />
              <ValidationMessage
                id="password-error"
                message={fieldErrors.password || passwordValidation.error}
                state={
                  fieldErrors.password || passwordValidation.isValid === false
                    ? "error"
                    : passwordValidation.isValid === true
                    ? "success"
                    : "idle"
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
                className={
                  "h-4 w-4 rounded border-input bg-background text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                }
                aria-describedby="rememberMe-description"
              />
              <label
                id="rememberMe-description"
                htmlFor="rememberMe"
                className="text-sm font-medium leading-none cursor-pointer select-none"
              >
                Remember me
              </label>
            </div>
            <FormError message={error ?? ""} />
            <Button
              className="w-full"
              type="submit"
              disabled={loading}
              loading={loading}
            >
              Sign in
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center">
          <div className="text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="text-primary hover:underline">
              Sign up
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
