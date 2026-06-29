import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataTable } from '@/components/ui/DataTable';
import { Column } from '@/types/table';

interface TestData {
  id: number;
  name: string;
  email: string;
  role: string;
  score: number;
}

const columns: Column<TestData>[] = [
  { id: 'id', header: 'ID', accessorKey: 'id', width: '80px' },
  { id: 'name', header: 'Name', accessorKey: 'name', sortable: true, filterable: true },
  { id: 'email', header: 'Email', accessorKey: 'email' },
  { id: 'role', header: 'Role', accessorKey: 'role', sortable: true },
  { id: 'score', header: 'Score', accessorKey: 'score', sortable: true, align: 'right' },
];

const testData: TestData[] = [
  { id: 1, name: 'Alice Johnson', email: 'alice@test.com', role: 'Admin', score: 95 },
  { id: 2, name: 'Bob Smith', email: 'bob@test.com', role: 'User', score: 80 },
  { id: 3, name: 'Charlie Brown', email: 'charlie@test.com', role: 'User', score: 75 },
  { id: 4, name: 'Diana Prince', email: 'diana@test.com', role: 'Moderator', score: 90 },
  { id: 5, name: 'Eve Wilson', email: 'eve@test.com', role: 'Admin', score: 88 },
];

describe('DataTable', () => {
  it('renders all columns and data', () => {
    render(<DataTable columns={columns} data={testData} />);

    expect(screen.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Score' })).toBeInTheDocument();

    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.getByText('bob@test.com')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<DataTable columns={columns} data={[]} loading={true} />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows empty message', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="Custom empty" />);
    expect(screen.getByText('Custom empty')).toBeInTheDocument();
  });

  it('sorts data when clicking column header', () => {
    render(<DataTable columns={columns} data={testData} />);

    const scoreHeader = screen.getByRole('columnheader', { name: 'Score' });
    fireEvent.click(scoreHeader);

    const rows = screen.getAllByRole('row');
    const lastRow = rows[rows.length - 1];
    expect(within(lastRow).getByText('75')).toBeInTheDocument();
  });

  it('filters data via search', () => {
    render(<DataTable columns={columns} data={testData} />);

    const searchInput = screen.getByPlaceholderText('Search...');
    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    expect(screen.getByText('Alice Johnson')).toBeInTheDocument();
    expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument();
  });

  it('paginates data', () => {
    const manyItems = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@test.com`,
      role: 'User',
      score: 50 + i,
    }));

    render(<DataTable columns={columns} data={manyItems} pageSize={10} />);

    expect(screen.getByText('25 total items')).toBeInTheDocument();
    expect(screen.getByText('User 1')).toBeInTheDocument();
    expect(screen.queryByText('User 11')).not.toBeInTheDocument();

    const nextButton = screen.getByLabelText('Next page');
    fireEvent.click(nextButton);

    expect(screen.getByText('User 11')).toBeInTheDocument();
  });

  it('calls onRowClick when row is clicked', () => {
    const handleRowClick = jest.fn();
    render(<DataTable columns={columns} data={testData} onRowClick={handleRowClick} />);

    const nameCell = screen.getByText('Alice Johnson');
    fireEvent.click(nameCell.closest('tr')!);

    expect(handleRowClick).toHaveBeenCalledWith(testData[0]);
  });
});
