"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { PasswordStrengthIndicator } from "@/components/ui/PasswordStrengthIndicator";
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
import { registerSchema, type RegisterFormData } from "@/lib/validations/auth";
import { useDebouncedValidation } from "@/hooks/useDebouncedValidation";

export default function RegisterPage() {
  const router = useRouter();
  const { register: registerUser, loading, error, clearError, user } = useAuth();
  const { addToast } = useNotifications();
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
  } = useDebouncedValidation<RegisterFormData>({
    schema: registerSchema,
    debounceMs: 300,
  });

  const handleFieldChange = useCallback(
    (field: keyof RegisterFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFieldValue(field, e.target.value);
      if (!touchedFields.has(field)) {
        setTouchedFields((prev) => new Set([...prev, field]));
        setFieldTouched(field);
      }
    },
    [setFieldValue, setFieldTouched, touchedFields]
  );

  const handleBlur = useCallback(
    (field: keyof RegisterFormData) => () => {
      if (!touchedFields.has(field)) {
        setTouchedFields((prev) => new Set([...prev, field]));
        setFieldTouched(field);
        validate();
      }
    },
    [touchedFields, setFieldTouched, validate]
  );

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
      addToast({
        type: "success",
        title: "Account created",
        message: `Welcome, ${user.username}!`,
        duration: 3000,
      });
      router.replace("/");
    }
  }, [user, router, addToast]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Mark all fields as touched on submit
    const allFields = ["username", "email", "password", "confirmPassword"] as const;
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

    await registerUser({
      username: values.username || "",
      email: values.email || "",
      password: values.password || "",
      confirmPassword: values.confirmPassword || "",
    });
  };

  const errorList = Object.values(errors).filter(Boolean) as string[];

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
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <ValidationSummary errors={errorList} />

            <FormField
              id="username"
              label="Username"
              type="text"
              value={values.username || ""}
              onChange={handleFieldChange("username")}
              onBlur={handleBlur("username")}
              placeholder="ArenaMaster"
              error={getFieldError("username")}
              success={getFieldSuccess("username")}
              disabled={loading}
              autoComplete="username"
            />

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
              <FormField
                id="password"
                label="Password"
                type="password"
                value={values.password || ""}
                onChange={handleFieldChange("password")}
                onBlur={handleBlur("password")}
                error={getFieldError("password")}
                success={getFieldSuccess("password")}
                disabled={loading}
                autoComplete="new-password"
              />
              <PasswordStrengthIndicator password={values.password || ""} />
            </div>

            <FormField
              id="confirmPassword"
              label="Confirm Password"
              type="password"
              value={values.confirmPassword || ""}
              onChange={handleFieldChange("confirmPassword")}
              onBlur={handleBlur("confirmPassword")}
              error={getFieldError("confirmPassword")}
              success={getFieldSuccess("confirmPassword")}
              disabled={loading}
              autoComplete="new-password"
            />

            <FormError message={error ?? ""} />

            <Button
              className="w-full"
              type="submit"
              disabled={loading}
              loading={loading}
              aria-describedby={errorList.length > 0 ? "validation-summary" : undefined}
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
