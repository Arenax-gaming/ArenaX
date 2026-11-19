import type { Meta, StoryObj } from "@storybook/react";
import { DataTable } from "./DataTable";
import type { Column } from "@/types/table";

interface Player {
  id: number;
  name: string;
  elo: number;
  wins: number;
}

const columns: Column<Player>[] = [
  { id: "name", header: "Player", accessorKey: "name", sortable: true },
  { id: "elo", header: "ELO", accessorKey: "elo", sortable: true, align: "right" },
  { id: "wins", header: "Wins", accessorKey: "wins", sortable: true, align: "right" },
];

const data: Player[] = [
  { id: 1, name: "redman9", elo: 1842, wins: 41 },
  { id: 2, name: "byteMara", elo: 1770, wins: 35 },
  { id: 3, name: "shaarknado", elo: 1695, wins: 28 },
  { id: 4, name: "Goodnessoj", elo: 1520, wins: 19 },
  { id: 5, name: "Ikechukwu", elo: 1488, wins: 17 },
  { id: 6, name: "Chummy", elo: 1401, wins: 12 },
];

const meta: Meta<typeof DataTable> = {
  title: "Molecules/DataTable",
  component: DataTable as never,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: {
    columns: columns as Column<any>[],
    data,
    pageSize: 5,
    sortable: true,
    searchable: true,
    exportable: true,
  },
  argTypes: {
    pageSize: { control: { type: "number", min: 1, max: 20 } },
    sortable: { control: "boolean" },
    searchable: { control: "boolean" },
    exportable: { control: "boolean" },
    selectable: { control: "boolean" },
    loading: { control: "boolean" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = {
  args: { data: [], emptyMessage: "No players match this filter" },
};

export const SelectableRows: Story = {
  args: { selectable: true, pageSize: 6 },
};

export const Paginated: Story = {
  args: {
    pageSize: 3,
    data: [
      ...data,
      { id: 7, name: "Ada", elo: 1322, wins: 9 },
      { id: 8, name: "Tunde", elo: 1290, wins: 7 },
    ],
  },
};
