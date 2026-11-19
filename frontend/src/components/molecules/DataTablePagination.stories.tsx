import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { DataTablePagination } from "./DataTablePagination";

const meta = {
  title: "Molecules/DataTablePagination",
  component: DataTablePagination,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: {
    page: 1,
    totalPages: 5,
    totalItems: 48,
    onPageChange: fn(),
  },
  argTypes: {
    page: { control: { type: "number", min: 1 } },
    totalPages: { control: { type: "number", min: 1 } },
    totalItems: { control: { type: "number", min: 0 } },
  },
} satisfies Meta<typeof DataTablePagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};
export const FirstPage: Story = { args: { page: 1 } };
export const MiddlePage: Story = { args: { page: 3 } };
export const LastPage: Story = { args: { page: 5 } };
export const ManyPages: Story = {
  args: { page: 12, totalPages: 24, totalItems: 236 },
};
