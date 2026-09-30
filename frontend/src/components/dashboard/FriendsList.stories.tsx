import type { Meta, StoryObj } from "@storybook/react";
import { FriendsList } from "./FriendsList";

const meta: Meta<typeof FriendsList> = {
  title: "Dashboard/FriendsList",
  component: FriendsList,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    friends: [
      { id: "f1", username: "ShadowNinja", elo: 1380, status: "online" },
      { id: "f2", username: "EliteSniper", elo: 1420, status: "in-game" },
      { id: "f3", username: "DragonSlayer", elo: 1190, status: "offline" },
    ],
  },
};

export const Loading: Story = {
  name: "Loading",
  args: {
    friends: [],
    isLoading: true,
  },
};

export const Error: Story = {
  args: {
    friends: [],
    isError: true,
  },
};