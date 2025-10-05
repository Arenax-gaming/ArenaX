"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signupSchema } from "@/lib/validation/auth";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import Link from "next/link";

type SignupForm = z.infer<typeof signupSchema>;

export default function SignupPage() {
  const form = useForm<SignupForm>({ resolver: zodResolver(signupSchema) });

  const onSubmit = (data: SignupForm) => {
    toast.success("Account created successfully!");
    console.log(data);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <Card className="w-full max-w-md p-6 bg-card border border-green-500/20 shadow-lg">
        <h1 className="text-2xl font-bold text-green-400 mb-4 text-center">
          Create ArenaX Account
        </h1>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Input placeholder="Full Name" {...form.register("fullName")} />
          {form.formState.errors.fullName && (
            <p className="text-red-500 text-sm">
              {form.formState.errors.fullName.message}
            </p>
          )}

          <Input placeholder="Email" {...form.register("email")} />
          {form.formState.errors.email && (
            <p className="text-red-500 text-sm">
              {form.formState.errors.email.message}
            </p>
          )}

          <Input
            type="password"
            placeholder="Password"
            {...form.register("password")}
          />
          <Input
            type="password"
            placeholder="Confirm Password"
            {...form.register("confirmPassword")}
          />

          {form.formState.errors.confirmPassword && (
            <p className="text-red-500 text-sm">
              {form.formState.errors.confirmPassword.message}
            </p>
          )}

          <Button
            type="submit"
            className="w-full bg-green-500 hover:bg-green-600 text-black font-semibold"
          >
            Sign Up
          </Button>
        </form>

        <p className="text-sm text-center mt-4 text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-green-400 hover:text-green-300">
            Log in
          </Link>
        </p>
      </Card>
    </div>
  );
}
