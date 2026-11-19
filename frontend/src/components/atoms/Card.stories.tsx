import type { Meta, StoryObj } from "@storybook/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./Card";
import { Button } from "./Button";

/**
 * `Card` is a container; the story composes its documented sub-components so
 * reviewers can see the intended header/content/footer structure.
 */
const meta = {
  title: "Atoms/Card",
  component: Card,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: { className: "w-80" },
  argTypes: { className: { control: "text" } },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <Card {...args}>
      <CardHeader>
        <CardTitle>Tournament Cup</CardTitle>
        <CardDescription>Single elimination · 16 players</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Entry fee 500 ARX. Registration closes in 2 hours.
        </p>
      </CardContent>
      <CardFooter>
        <Button size="sm">Join</Button>
      </CardFooter>
    </Card>
  ),
};

export const ContentOnly: Story = {
  render: (args) => (
    <Card {...args}>
      <CardContent>
        <p className="text-sm">A bare card with only body content.</p>
      </CardContent>
    </Card>
  ),
};
