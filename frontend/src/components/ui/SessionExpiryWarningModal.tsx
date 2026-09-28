"use client";

import { SessionTimeoutModal } from "@/components/ui/SessionTimeoutModal";
import { useSessionExpiryWarning } from "@/hooks/useSessionExpiryWarning";

/**
 * Mount once, near the app root, inside `AuthProvider`. Shows a countdown
 * warning 2 minutes before the access token expires; does nothing on public
 * pages or when there is no signed-in user (#1090).
 */
export function SessionExpiryWarningModal() {
  const { isOpen, secondsRemaining, extend, signOut } = useSessionExpiryWarning();

  return (
    <SessionTimeoutModal
      isOpen={isOpen}
      timeRemaining={secondsRemaining}
      onExtend={extend}
      onForceLogout={signOut}
      onClose={() => {}}
    />
  );
}
