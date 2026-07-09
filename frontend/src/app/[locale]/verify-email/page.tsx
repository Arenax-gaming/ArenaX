"use client";

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function OldVerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    router.replace(`/auth/verify-email?${params.toString()}`);
  }, [router, searchParams]);

  return null;
}

export default function OldVerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <OldVerifyEmailContent />
    </Suspense>
  );
}
