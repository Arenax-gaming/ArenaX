"use client";

import { Tournament } from "@/types/tournament";
import { Modal } from "@/components/ui/Modal";
import { RegistrationForm } from "./RegistrationForm";

interface TournamentRegistrationModalProps {
  tournament: Tournament;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Reusable registration modal — wraps RegistrationForm so every entry point
 * shares the same payment, fee estimation and balance handling.
 */
export function TournamentRegistrationModal({
  tournament,
  isOpen,
  onClose,
  onSuccess,
}: TournamentRegistrationModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Register for ${tournament.name}`}
      size="md"
    >
      <RegistrationForm
        tournament={tournament}
        onSuccess={onSuccess}
        onCancel={onClose}
      />
    </Modal>
  );
}
