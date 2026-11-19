import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { DataTableToolbar } from "./DataTableToolbar";
import type { Column } from "@/types/table";

interface Player {
  id: number;
  name: string;
  elo: number;
}

const columns: Column<Player>[] = [
  { id: "name", header: "Player", accessorKey: "name" },
  { id: "elo", header: "ELO", accessorKey: "elo" },
];

const meta = {
  title: "Molecules/DataTableToolbar",
  component: DataTableToolbar,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: {
    columns: columns as Column<any>[],
    globalSearch: "",
    visibleColumns: ["name", "elo"],
    exportable: true,
    searchable: true,
    onGlobalSearchChange: fn(),
    onExport: fn(),
    onToggleColumn: fn(),
  },
  argTypes: {
    exportable: { control: "boolean" },
    searchable: { control: "boolean" },
    globalSearch: { control: "text" },
  },
} satisfies Meta<typeof DataTableToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithSearchText: Story = {
  args: { globalSearch: "redman" },
};

export const SearchOnly: Story = {
  args: { exportable: false },
};

export const Interactive: Story = {
  render: (args) => {
    const [search, setSearch] = useState(args.globalSearch);
    return (
      <DataTableToolbar
        {...args}
        globalSearch={search}
        onGlobalSearchChange={setSearch}
      />
    );
  },
};
