import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "./Select";

/**
 * Composed exactly as in the app (`leaderboard/page.tsx`): a controlled
 * `Select` wrapping a native `SelectTrigger` and `SelectItem` options.
 */
const meta = {
  title: "Atoms/Select",
  component: Select,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  argTypes: {
    value: { control: "select", options: ["ranked", "casual", "1v1", "2v2"] },
    disabled: { control: "boolean" },
  },
  args: {
    value: "ranked",
    disabled: false,
    children: null,
    onValueChange: fn(),
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const OPTIONS = [
  { value: "ranked", label: "Ranked" },
  { value: "casual", label: "Casual" },
  { value: "1v1", label: "1v1 Duel" },
  { value: "2v2", label: "2v2 Team Battle" },
];

function SelectExample({
  initialValue,
  disabled,
}: {
  initialValue: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <Select value={value} onValueChange={setValue} disabled={disabled}>
      <SelectTrigger className="w-56" aria-label="Game mode">
        <SelectValue placeholder="Choose a mode" />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const Playground: Story = {
  args: { value: "ranked", disabled: false, children: null, onValueChange: fn() },
  render: (args) => (
    <SelectExample initialValue={args.value} disabled={args.disabled} />
  ),
};

export const Disabled: Story = {
  args: { value: "ranked", disabled: true, children: null, onValueChange: fn() },
  render: (args) => (
    <SelectExample initialValue={args.value} disabled={args.disabled} />
  ),
};
