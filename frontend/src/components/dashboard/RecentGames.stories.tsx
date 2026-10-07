import type { Meta, StoryObj } from "@storybook/react";
import { RecentGames } from "./RecentGames";

const meta: Meta<typeof RecentGames> = {
  title: "Dashboard/RecentGames",
  component: RecentGames,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    matches: [],
    currentUserId: "u1",
  },
};

export const Loading: Story = {
  name: "Loading",
  args: {
    matches: [],
    currentUserId: "u1",
    isLoading: true,
  },
};

export const Error: Story = {
  args: {
    matches: [],
    currentUserId: "u1",
    isError: true,
  },
};