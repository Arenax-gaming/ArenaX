import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";

const meta = {
  title: "Atoms/Input",
  component: Input,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    placeholder: "Enter your username",
    disabled: false,
    error: false,
    type: "text",
  },
  argTypes: {
    error: {
      control: "boolean",
      description: "Renders the destructive border/focus ring",
    },
    disabled: { control: "boolean" },
    placeholder: { control: "text" },
    type: {
      control: "select",
      options: ["text", "email", "password", "number", "search"],
    },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Default: Story = { args: { defaultValue: "redman9" } };
export const Email: Story = {
  args: { type: "email", placeholder: "you@example.com" },
};
export const Password: Story = {
  args: { type: "password", defaultValue: "hunter2" },
};
export const Error: Story = {
  args: { error: true, defaultValue: "not-an-email", type: "email" },
};
export const Disabled: Story = {
  args: { disabled: true, defaultValue: "locked" },
};
