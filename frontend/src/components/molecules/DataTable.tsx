'use client';

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Column, DataTableProps, SortConfig } from '@/types/table';
import { useDataTable } from '@/hooks/useDataTable';
import { DataTableToolbar } from './DataTableToolbar';
import { DataTablePagination } from './DataTablePagination';
import { exportToCsv, exportToExcel } from '@/lib/export';

const ROW_HEIGHT = 48;
const OVERSCAN = 5;

function DataTableInner<T extends Record<string, any>>({
  columns,
  data,
  pageSize = 10,
  sortable = true,
  filterable = false,
  searchable = true,
  exportable = true,
  virtualized = false,
  selectable = false,
  loading = false,
  emptyMessage = 'No data found',
  onRowClick,
  className,
}: DataTableProps<T>) {
  const {
    state,
    data: pageData,
    filteredData,
    pagination,
    totalPages,
    toggleSort,
    setGlobalSearch,
    setPage,
    toggleColumn,
    resetState,
  } = useDataTable({ columns, data, pageSize });

  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const tableRef = useRef<HTMLDivElement>(null);

  const visibleCols = columns.filter(c => state.visibleColumns.includes(c.id));

  const handleSort = useCallback((columnId: string) => {
    if (sortable) toggleSort(columnId);
  }, [sortable, toggleSort]);

  const handleExport = useCallback((format: 'csv' | 'excel') => {
    if (format === 'csv') exportToCsv(filteredData, columns, 'export');
    else exportToExcel(filteredData, columns, 'export');
  }, [filteredData, columns]);

  const toggleAllRows = useCallback(() => {
    if (selectedRows.size === pageData.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(pageData.map((_, i) => i)));
    }
  }, [selectedRows, pageData]);

  const toggleRow = useCallback((index: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const getSortIndicator = (columnId: string) => {
    const sort = state.sorts.find(s => s.columnId === columnId);
    if (!sort) return <ChevronsUpDown className="h-4 w-4 text-muted-foreground/50" />;
    return sort.direction === 'asc'
      ? <ChevronUp className="h-4 w-4 text-primary" />
      : <ChevronDown className="h-4 w-4 text-primary" />;
  };

  const getCellValue = (row: T, col: Column<T>): React.ReactNode => {
    if (col.renderCell) return col.renderCell(row);
    if (typeof col.accessorKey === 'function') return col.accessorKey(row);
    return (row[col.accessorKey] ?? '') as React.ReactNode;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const containerStyle = virtualized && filteredData.length > 0
    ? { height: Math.min(filteredData.length, 20) * ROW_HEIGHT + 48 }
    : {};

  return (
    <div className={cn('rounded-lg border', className)}>
      {(searchable || exportable) && (
        <DataTableToolbar
          columns={columns}
          globalSearch={state.globalSearch}
          onGlobalSearchChange={setGlobalSearch}
          onExport={handleExport}
          visibleColumns={state.visibleColumns}
          onToggleColumn={toggleColumn}
          exportable={exportable}
          searchable={searchable}
        />
      )}

      <div className="overflow-x-auto" ref={tableRef}>
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b">
              {selectable && (
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedRows.size === pageData.length && pageData.length > 0}
                    onChange={toggleAllRows}
                    className="rounded border-gray-300"
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {visibleCols.map(col => (
                <th
                  key={col.id}
                  className={cn(
                    'px-4 py-3 text-sm font-semibold text-foreground/70',
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                    sortable && col.sortable !== false && 'cursor-pointer hover:bg-muted select-none'
                  )}
                  style={{ width: col.width }}
                  onClick={() => col.sortable !== false && handleSort(col.id)}
                  scope="col"
                  aria-sort={
                    state.sorts.find(s => s.columnId === col.id)?.direction === 'asc' ? 'ascending' :
                    state.sorts.find(s => s.columnId === col.id)?.direction === 'desc' ? 'descending' : undefined
                  }
                >
                  <div className={cn('flex items-center gap-2', col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : '')}>
                    {col.header}
                    {sortable && col.sortable !== false && getSortIndicator(col.id)}
                  </div>
                </th>
              ))}
              {onRowClick && <th className="px-4 py-3 w-10" />}
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleCols.length + (selectable ? 1 : 0) + (onRowClick ? 1 : 0)}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-2">
                    <ChevronsUpDown className="h-8 w-8 text-muted-foreground/50" />
                    <span>{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              pageData.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={cn(
                    'border-b last:border-b-0 hover:bg-muted/50 transition-colors',
                    rowIndex % 2 === 0 ? 'bg-background' : 'bg-muted/20',
                    onRowClick && 'cursor-pointer'
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {selectable && (
                    <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(rowIndex)}
                        onChange={() => toggleRow(rowIndex)}
                        className="rounded border-gray-300"
                        aria-label={`Select row ${rowIndex + 1}`}
                      />
                    </td>
                  )}
                  {visibleCols.map(col => (
                    <td
                      key={col.id}
                      className={cn(
                        'px-4 py-3 text-sm',
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                      )}
                    >
                      {getCellValue(row, col)}
                    </td>
                  ))}
                  {onRowClick && (
                    <td className="px-4 py-3 w-10">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DataTablePagination
        page={pagination.page}
        totalPages={totalPages}
        totalItems={pagination.totalItems}
        onPageChange={setPage}
      />
    </div>
  );
}

export function DataTable<T extends Record<string, any>>(props: DataTableProps<T>) {
  return <DataTableInner {...props} />;
}
