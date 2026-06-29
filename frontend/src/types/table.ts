export interface Column<T> {
  id: string;
  header: string;
  accessorKey: keyof T | ((row: T) => React.ReactNode);
  sortable?: boolean;
  filterable?: boolean;
  hidden?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  renderCell?: (row: T) => React.ReactNode;
}

export interface SortConfig {
  columnId: string;
  direction: 'asc' | 'desc';
}

export interface FilterConfig {
  columnId: string;
  value: string;
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'between';
}

export interface PaginationConfig {
  page: number;
  pageSize: number;
  totalItems: number;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  pageSize?: number;
  sortable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  exportable?: boolean;
  virtualized?: boolean;
  selectable?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  onSortChange?: (sorts: SortConfig[]) => void;
  onFilterChange?: (filters: FilterConfig[]) => void;
  onExport?: (format: 'csv' | 'excel') => void;
  className?: string;
}

export interface DataTableState {
  sorts: SortConfig[];
  filters: FilterConfig[];
  globalSearch: string;
  visibleColumns: string[];
  page: number;
}
