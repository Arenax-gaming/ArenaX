import type { Meta, StoryObj } from "@storybook/react";
import { StatsOverview } from "./StatsOverview";

const meta: Meta<typeof StatsOverview> = {
  title: "Dashboard/StatsOverview",
  component: StatsOverview,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    elo: 1423,
    wins: 42,
    losses: 18,
    winRate: 70,
    rank: 128,
    streak: 4,
  },
};

export const Loading: Story = {
  name: "Loading",
  args: {
    elo: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    rank: 0,
    streak: 0,
    isLoading: true,
  },
};

export const Error: Story = {
  args: {
    elo: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    rank: 0,
    streak: 0,
    isError: true,
  },
};