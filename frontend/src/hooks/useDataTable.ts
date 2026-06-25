'use client';

import { useState, useMemo, useCallback } from 'react';
import { Column, SortConfig, FilterConfig, PaginationConfig, DataTableState } from '@/types/table';

interface UseDataTableOptions<T> {
  columns: Column<T>[];
  data: T[];
  pageSize?: number;
  defaultSorts?: SortConfig[];
}

export function useDataTable<T>({ columns, data, pageSize = 10, defaultSorts = [] }: UseDataTableOptions<T>) {
  const [state, setState] = useState<DataTableState>({
    sorts: defaultSorts,
    filters: [],
    globalSearch: '',
    visibleColumns: columns.filter(c => !c.hidden).map(c => c.id),
    page: 1,
  });

  const filteredData = useMemo(() => {
    let result = [...data];

    if (state.globalSearch) {
      const q = state.globalSearch.toLowerCase();
      result = result.filter(row =>
        columns.some(col => {
          if (col.hidden) return false;
          const val = typeof col.accessorKey === 'function' ? '' : String(row[col.accessorKey] ?? '');
          return val.toLowerCase().includes(q);
        })
      );
    }

    for (const filter of state.filters) {
      result = result.filter(row => {
        const col = columns.find(c => c.id === filter.columnId);
        if (!col) return true;
        const val = typeof col.accessorKey === 'function' ? '' : String(row[col.accessorKey] ?? '');
        switch (filter.operator) {
          case 'contains': return val.toLowerCase().includes(filter.value.toLowerCase());
          case 'equals': return val.toLowerCase() === filter.value.toLowerCase();
          case 'startsWith': return val.toLowerCase().startsWith(filter.value.toLowerCase());
          case 'endsWith': return val.toLowerCase().endsWith(filter.value.toLowerCase());
          default: return true;
        }
      });
    }

    return result;
  }, [data, columns, state.filters, state.globalSearch]);

  const sortedData = useMemo(() => {
    if (state.sorts.length === 0) return filteredData;
    return [...filteredData].sort((a, b) => {
      for (const sort of state.sorts) {
        const col = columns.find(c => c.id === sort.columnId);
        if (!col || typeof col.accessorKey === 'function') continue;
        const aVal = a[col.accessorKey];
        const bVal = b[col.accessorKey];
        if (aVal < bVal) return sort.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sort.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [filteredData, state.sorts, columns]);

  const paginatedData = useMemo(() => {
    const start = (state.page - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, state.page, pageSize]);

  const pagination: PaginationConfig = useMemo(() => ({
    page: state.page,
    pageSize,
    totalItems: sortedData.length,
  }), [state.page, pageSize, sortedData.length]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));

  const setSorts = useCallback((sorts: SortConfig[]) => {
    setState(s => ({ ...s, sorts }));
  }, []);

  const toggleSort = useCallback((columnId: string) => {
    setState(s => {
      const existing = s.sorts.find(s => s.columnId === columnId);
      if (existing) {
        if (existing.direction === 'asc') {
          return { ...s, sorts: s.sorts.map(s => s.columnId === columnId ? { ...s, direction: 'desc' as const } : s) };
        }
        return { ...s, sorts: s.sorts.filter(s => s.columnId !== columnId) };
      }
      return { ...s, sorts: [...s.sorts, { columnId, direction: 'asc' as const }] };
    });
  }, []);

  const setFilters = useCallback((filters: FilterConfig[]) => {
    setState(s => ({ ...s, filters, page: 1 }));
  }, []);

  const addFilter = useCallback((filter: FilterConfig) => {
    setState(s => ({ ...s, filters: [...s.filters, filter], page: 1 }));
  }, []);

  const removeFilter = useCallback((columnId: string) => {
    setState(s => ({ ...s, filters: s.filters.filter(f => f.columnId !== columnId), page: 1 }));
  }, []);

  const setGlobalSearch = useCallback((globalSearch: string) => {
    setState(s => ({ ...s, globalSearch, page: 1 }));
  }, []);

  const setPage = useCallback((page: number) => {
    setState(s => ({ ...s, page: Math.max(1, Math.min(page, totalPages)) }));
  }, [totalPages]);

  const toggleColumn = useCallback((columnId: string) => {
    setState(s => ({
      ...s,
      visibleColumns: s.visibleColumns.includes(columnId)
        ? s.visibleColumns.filter(c => c !== columnId)
        : [...s.visibleColumns, columnId],
    }));
  }, []);

  const setVisibleColumns = useCallback((visibleColumns: string[]) => {
    setState(s => ({ ...s, visibleColumns }));
  }, []);

  const resetState = useCallback(() => {
    setState({
      sorts: [],
      filters: [],
      globalSearch: '',
      visibleColumns: columns.filter(c => !c.hidden).map(c => c.id),
      page: 1,
    });
  }, [columns]);

  return {
    state,
    data: paginatedData,
    filteredData,
    sortedData,
    pagination,
    totalPages,
    setSorts,
    toggleSort,
    setFilters,
    addFilter,
    removeFilter,
    setGlobalSearch,
    setPage,
    toggleColumn,
    setVisibleColumns,
    resetState,
  };
}
