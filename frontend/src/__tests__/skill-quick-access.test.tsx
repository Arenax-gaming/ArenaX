import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SkillQuickAccessBar, { defaultSkills } from "../components/game/SkillQuickAccessBar";

describe("SkillQuickAccessBar Component", () => {
  const mockKeyBindings = [
    { action: "Skill 1 (Primary)", primaryKey: "1", modifier: "None" as const },
    { action: "Skill 2 (Secondary)", primaryKey: "2", modifier: "None" as const },
    { action: "Skill Quick Boost", primaryKey: "Q", modifier: "Shift" as const },
  ];

  it("renders all skill buttons with 44x44px minimum touch targets", () => {
    render(<SkillQuickAccessBar skills={defaultSkills} keyBindings={mockKeyBindings} />);

    const skillButtons = screen.getAllByRole("button");
    expect(skillButtons.length).toBe(defaultSkills.length);

    skillButtons.forEach((button) => {
      expect(button).toHaveClass("min-w-[48px]");
      expect(button).toHaveClass("min-h-[48px]");
    });
  });

  it("displays keybinding hints on skill buttons", () => {
    render(<SkillQuickAccessBar skills={defaultSkills} keyBindings={mockKeyBindings} />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Shift+Q")).toBeInTheDocument();
  });

  it("triggers callback when skill button is clicked", () => {
    const handleActivate = jest.fn();
    render(
      <SkillQuickAccessBar
        skills={defaultSkills}
        keyBindings={mockKeyBindings}
        onActivateSkill={handleActivate}
      />
    );

    const firstSkillBtn = screen.getByRole("button", { name: /Plasma Blast/i });
    fireEvent.click(firstSkillBtn);

    expect(handleActivate).toHaveBeenCalledWith(defaultSkills[0]);
  });

  it("triggers skill on matching key combination press", () => {
    const handleActivate = jest.fn();
    render(
      <SkillQuickAccessBar
        skills={defaultSkills}
        keyBindings={mockKeyBindings}
        onActivateSkill={handleActivate}
      />
    );

    // Trigger Shift+Q
    fireEvent.keyDown(window, { key: "Q", shiftKey: true });
    expect(handleActivate).toHaveBeenCalledWith(
      defaultSkills.find((s) => s.actionName === "Skill Quick Boost")
    );
  });
});
