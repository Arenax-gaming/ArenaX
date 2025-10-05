"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import Link from "next/link";

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const form = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = (data: ForgotPasswordForm) => {
    toast.info("Password reset link sent to your email!");
    console.log(data);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <Card className="w-full max-w-md p-6 bg-card border border-green-500/20 shadow-lg">
        <h1 className="text-2xl font-bold text-green-400 mb-4 text-center">
          Reset Password
        </h1>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Input placeholder="Email" {...form.register("email")} />
          {form.formState.errors.email && (
            <p className="text-red-500 text-sm mt-1">
              {form.formState.errors.email.message}
            </p>
          )}

          <Button
            type="submit"
            className="w-full bg-green-500 hover:bg-green-600 text-black font-semibold"
          >
            Send Reset Link
          </Button>
        </form>

        <p className="text-sm text-center mt-4 text-muted-foreground">
          <Link href="/login" className="text-green-400 hover:text-green-300">
            Back to login
          </Link>
        </p>
      </Card>
    </div>
  );
}
