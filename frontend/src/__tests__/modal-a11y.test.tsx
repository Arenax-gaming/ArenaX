/**
 * Modal accessibility (Issue #1327): ARIA wiring, Escape, backdrop click,
 * and focus restoration to the trigger.
 */

import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Modal } from "@/components/ui/Modal";

jest.mock("@/hooks/useReducedMotion", () => ({ useReducedMotion: () => true }));

function Harness({
  onClose,
  closeOnOverlayClick = true,
}: {
  onClose?: () => void;
  closeOnOverlayClick?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open settings</button>
      <Modal
        isOpen={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Edit profile"
        closeOnOverlayClick={closeOnOverlayClick}
      >
        <button>First action</button>
        <button>Last action</button>
      </Modal>
    </>
  );
}

describe("Modal accessibility", () => {
  it("exposes dialog semantics labelled by its title", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open settings"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)).toHaveTextContent("Edit profile");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const onClose = jest.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByText("Open settings");
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("respects closeOnOverlayClick", () => {
    const onClose = jest.fn();
    render(<Harness onClose={onClose} closeOnOverlayClick={false} />);
    fireEvent.click(screen.getByText("Open settings"));

    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = jest.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText("Open settings"));

    fireEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
