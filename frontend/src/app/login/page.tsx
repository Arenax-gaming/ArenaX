"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { loginSchema } from "@/lib/validation/auth";

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = (data: LoginForm) => {
    toast.success("Logged in successfully!");
    console.log(data);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <Card className="w-full max-w-md p-6 bg-card border border-green-500/20 shadow-lg">
        <h1 className="text-2xl font-bold text-green-400 mb-4 text-center">
          Login to ArenaX
        </h1>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <Input
              placeholder="Email"
              {...form.register("email")}
              className="bg-input text-foreground"
            />
            {form.formState.errors.email && (
              <p className="text-red-500 text-sm mt-1">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>

          <div>
            <Input
              type="password"
              placeholder="Password"
              {...form.register("password")}
              className="bg-input text-foreground"
            />
            {form.formState.errors.password && (
              <p className="text-red-500 text-sm mt-1">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full bg-green-500 hover:bg-green-600 text-black font-semibold"
          >
            Login
          </Button>
        </form>

        <div className="flex justify-between text-sm mt-4 text-muted-foreground">
          <Link href="/signup" className="hover:text-green-400">
            Create account
          </Link>
          <Link href="/forgot-password" className="hover:text-green-400">
            Forgot password?
          </Link>
        </div>
      </Card>
    </div>
  );
}
