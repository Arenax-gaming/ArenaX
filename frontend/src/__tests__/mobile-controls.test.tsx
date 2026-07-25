import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import MobileGameControls from "../components/game/MobileGameControls";

// Mock useDevice to simulate mobile device
jest.mock("../hooks/useMobile", () => ({
  useDevice: () => ({ isMobile: true, isLandscape: false }),
  useVibration: () => ({ vibrate: jest.fn() }),
}));

describe("MobileGameControls Component", () => {
  it("renders mobile controls with 44x44px minimum touch targets when on mobile", () => {
    render(<MobileGameControls />);

    const attackBtn = screen.getByRole("button", { name: /Action A/i });
    const specialBtn = screen.getByRole("button", { name: /Action B/i });
    const jumpBtn = screen.getByRole("button", { name: /Action J/i });
    const pauseBtn = screen.getByRole("button", { name: /Pause game/i });

    expect(attackBtn).toHaveClass("min-w-[44px]");
    expect(attackBtn).toHaveClass("min-h-[44px]");

    expect(specialBtn).toHaveClass("min-w-[44px]");
    expect(specialBtn).toHaveClass("min-h-[44px]");

    expect(jumpBtn).toHaveClass("min-w-[44px]");
    expect(jumpBtn).toHaveClass("min-h-[44px]");

    expect(pauseBtn).toHaveClass("min-w-[44px]");
    expect(pauseBtn).toHaveClass("min-h-[44px]");
  });
});
