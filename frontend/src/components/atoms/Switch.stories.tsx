import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Switch } from "./Switch";

/**
 * Controlled component: the story keeps local state so the switch actually
 * toggles while reviewers interact with the Controls panel.
 */
const meta = {
  title: "Atoms/Switch",
  component: Switch,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    checked: false,
    disabled: false,
  },
  argTypes: {
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
    onCheckedChange: { action: "checked changed" },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => {
    const [checked, setChecked] = useState(args.checked ?? false);
    return (
      <div className="flex items-center gap-3">
        <Switch
          {...args}
          checked={checked}
          onCheckedChange={(next) => {
            setChecked(next);
            args.onCheckedChange?.(next);
          }}
          aria-label="Notifications"
        />
        <span className="text-sm text-muted-foreground">
          {checked ? "Enabled" : "Disabled"}
        </span>
      </div>
    );
  },
};

export const Checked: Story = {
  args: { checked: true },
  render: Playground.render,
};

export const Disabled: Story = {
  args: { disabled: true },
  render: Playground.render,
};

export const DisabledChecked: Story = {
  args: { disabled: true, checked: true },
  render: Playground.render,
};
