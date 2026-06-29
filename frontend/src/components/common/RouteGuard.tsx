import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export interface RouteGuardProps {
  children: React.ReactNode;
  isAuthenticated: boolean;
  redirectPath?: string;
}

/**
 * Component for Advanced Routing with Route Guards (Resolves #600)
 */
export const RouteGuard: React.FC<RouteGuardProps> = ({ children, isAuthenticated, redirectPath = '/login' }) => {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push(redirectPath);
    } else {
      setAuthorized(true);
    }
  }, [isAuthenticated, router, redirectPath]);

  return authorized ? <>{children}</> : null;
};
