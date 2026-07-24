'use client';

import { Search, X, Download, Columns } from 'lucide-react';
import { Input } from './Input';
import { Button } from './Button';
import { Column } from '@/types/table';

interface DataTableToolbarProps<T> {
  columns: Column<T>[];
  globalSearch: string;
  onGlobalSearchChange: (value: string) => void;
  onExport: (format: 'csv' | 'excel') => void;
  visibleColumns: string[];
  onToggleColumn: (columnId: string) => void;
  exportable?: boolean;
  searchable?: boolean;
}

export function DataTableToolbar<T>({
  globalSearch,
  onGlobalSearchChange,
  onExport,
  visibleColumns,
  onToggleColumn,
  columns,
  exportable = true,
  searchable = true,
}: DataTableToolbarProps<T>) {
  return (
    <div className="flex items-center justify-between p-4 border-b gap-4">
      {searchable && (
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={globalSearch}
            onChange={e => onGlobalSearchChange(e.target.value)}
            placeholder="Search..."
            className="pl-10 pr-8"
          />
          {globalSearch && (
            <button
              onClick={() => onGlobalSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative group">
          <Button variant="outline" size="sm">
            <Columns className="h-4 w-4 mr-2" />
            Columns
          </Button>
          <div className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-lg p-2 min-w-[160px] z-50 hidden group-hover:block">
            {columns.filter(c => !c.hidden).map(col => (
              <label
                key={col.id}
                className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted rounded cursor-pointer whitespace-nowrap"
              >
                <input
                  type="checkbox"
                  checked={visibleColumns.includes(col.id)}
                  onChange={() => onToggleColumn(col.id)}
                  className="rounded border-gray-300"
                />
                {col.header}
              </label>
            ))}
          </div>
        </div>

        {exportable && (
          <div className="relative group">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <div className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-lg p-1 min-w-[120px] z-50 hidden group-hover:block">
              <button
                onClick={() => onExport('csv')}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded"
              >
                Export CSV
              </button>
              <button
                onClick={() => onExport('excel')}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded"
              >
                Export Excel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
