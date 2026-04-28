"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { ValidationSummary } from "@/components/ui/ValidationSummary";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/contexts/NotificationContext";
import { loginSchema, type LoginFormData } from "@/lib/validations/auth";
import { useDebouncedValidation } from "@/hooks/useDebouncedValidation";

export default function LoginPage() {
  const router = useRouter();
  const { login, loading, error, clearError, user } = useAuth();
  const { addToast } = useNotifications();
  const [rememberMe, setRememberMe] = useState(false);
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());

  const {
    values,
    errors,
    isValid,
    setFieldValue,
    setFieldTouched,
    validate,
    getFieldError,
    getFieldSuccess,
  } = useDebouncedValidation<LoginFormData>({
    schema: loginSchema,
    debounceMs: 300,
  });

  const handleFieldChange = useCallback(
    (field: keyof LoginFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = field === "rememberMe" ? e.target.checked : e.target.value;
      setFieldValue(field, value);
      if (!touchedFields.has(field)) {
        setTouchedFields((prev) => new Set([...prev, field]));
        setFieldTouched(field);
      }
    },
    [setFieldValue, setFieldTouched, touchedFields]
  );

  const handleBlur = useCallback(
    (field: keyof LoginFormData) => () => {
      if (!touchedFields.has(field)) {
        setTouchedFields((prev) => new Set([...prev, field]));
        setFieldTouched(field);
        validate();
      }
    },
    [touchedFields, setFieldTouched, validate]
  );

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

    // Mark all fields as touched on submit
    const allFields = ["email", "password"] as const;
    allFields.forEach((field) => {
      if (!touchedFields.has(field)) {
        setTouchedFields((prev) => new Set([...prev, field]));
        setFieldTouched(field);
      }
    });

    const isValidForm = validate();
    if (!isValidForm) {
      return;
    }

    await login({
      email: values.email || "",
      password: values.password || "",
      rememberMe: values.rememberMe || false,
    });
  };

  const errorList = Object.values(errors).filter(Boolean) as string[];

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
            <ValidationSummary errors={errorList} />

            <FormField
              id="email"
              label="Email"
              type="email"
              value={values.email || ""}
              onChange={handleFieldChange("email")}
              onBlur={handleBlur("email")}
              placeholder="m@example.com"
              error={getFieldError("email")}
              success={getFieldSuccess("email")}
              disabled={loading}
              autoComplete="email"
            />

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
              <FormField
                id="password"
                label=""
                type="password"
                value={values.password || ""}
                onChange={handleFieldChange("password")}
                onBlur={handleBlur("password")}
                error={getFieldError("password")}
                success={getFieldSuccess("password")}
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="rememberMe"
                checked={values.rememberMe || false}
                onChange={(e) => setFieldValue("rememberMe", e.target.checked)}
                disabled={loading}
                className="h-4 w-4 rounded border-input bg-background text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
              aria-describedby={errorList.length > 0 ? "validation-summary" : undefined}
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
