"use client";

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { EmailVerification } from '@/components/auth/EmailVerification';
import { useAuth } from '@/hooks/useAuth';

export default function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { verifyEmail, user } = useAuth();
  const token = searchParams.get('token');

  useEffect(() => {
    if (token) {
      const verify = async () => {
        try {
          await verifyEmail(token);
          router.push('/');
        } catch (err) {
          // Error is handled by useAuth
        }
      };
      verify();
    }
  }, [token, verifyEmail, router]);

  return (
    <AuthLayout
      title="Verify your email"
      subtitle="Enter the code we sent to your email"
      type="verify-email"
    >
      <EmailVerification />
    </AuthLayout>
  );
}
