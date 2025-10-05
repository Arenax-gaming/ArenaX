"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AuthCardProps {
  title: string;
  children: React.ReactNode;
}

export function AuthCard({ title, children }: AuthCardProps) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background text-foreground px-6 py-10">
      <Card className="w-full max-w-md border border-border bg-card/60 backdrop-blur-md shadow-xl rounded-2xl">
        <CardHeader>
          <CardTitle className="text-center text-3xl font-semibold text-primary tracking-tight drop-shadow-sm">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">{children}</CardContent>
      </Card>
    </div>
  );
}
