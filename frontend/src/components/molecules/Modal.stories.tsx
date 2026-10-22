import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { Modal } from "./Modal";
import { Button } from "../atoms/Button";

const meta = {
  title: "Molecules/Modal",
  component: Modal,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    isOpen: true,
    title: "Forfeit match",
    onClose: fn(),
    children: (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Leaving now counts as a forfeit and may affect your ELO rating.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm">
            Keep playing
          </Button>
          <Button variant="destructive" size="sm">
            Forfeit
          </Button>
        </div>
      </div>
    ),
    size: "md",
    position: "center",
    closeOnOverlayClick: true,
    closeOnEscape: true,
    showCloseButton: true,
  },
  argTypes: {
    isOpen: { control: "boolean" },
    size: { control: "select", options: ["sm", "md", "lg", "xl", "full"] },
    position: { control: "select", options: ["center", "top", "bottom"] },
    closeOnOverlayClick: { control: "boolean" },
    closeOnEscape: { control: "boolean" },
    showCloseButton: { control: "boolean" },
    title: { control: "text" },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Small: Story = { args: { size: "sm", title: "Confirm" } };
export const Large: Story = { args: { size: "lg", title: "Match details" } };
export const TopAligned: Story = { args: { position: "top" } };
export const NoCloseButton: Story = { args: { showCloseButton: false } };

export const Interactive: Story = {
  render: (args) => {
    const [open, setOpen] = useState(true);
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open modal</Button>
        <Modal
          {...args}
          isOpen={open}
          onClose={() => {
            setOpen(false);
            args.onClose();
          }}
        />
      </div>
    );
  },
};
