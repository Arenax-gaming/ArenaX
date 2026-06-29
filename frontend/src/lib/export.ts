import { Column } from '@/types/table';

function getCellValue<T>(row: T, column: Column<T>): string {
  const value = typeof column.accessorKey === 'function'
    ? column.accessorKey(row)
    : row[column.accessorKey];

  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && 'props' in (value as any)) return '';
  return String(value);
}

export function exportToCsv<T>(
  data: T[],
  columns: Column<T>[],
  filename: string
): void {
  const visibleCols = columns.filter(c => !c.hidden);
  const headers = visibleCols.map(c => `"${c.header.replace(/"/g, '""')}"`).join(',');
  const rows = data.map(row =>
    visibleCols.map(col => {
      const val = getCellValue(row, col);
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',')
  );

  const csv = [headers, ...rows].join('\n');
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
}

export function exportToExcel<T>(
  data: T[],
  columns: Column<T>[],
  filename: string
): void {
  const visibleCols = columns.filter(c => !c.hidden);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
  xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
  xml += ' <Worksheet ss:Name="Sheet1">\n';
  xml += '  <Table>\n';

  xml += '   <Row>\n';
  for (const col of visibleCols) {
    xml += `    <Cell><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>\n`;
  }
  xml += '   </Row>\n';

  for (const row of data) {
    xml += '   <Row>\n';
    for (const col of visibleCols) {
      const val = getCellValue(row, col);
      const isNumeric = !isNaN(Number(val)) && val !== '';
      xml += `    <Cell><Data ss:Type="${isNumeric ? 'Number' : 'String'}">${escapeXml(val)}</Data></Cell>\n`;
    }
    xml += '   </Row>\n';
  }

  xml += '  </Table>\n';
  xml += ' </Worksheet>\n';
  xml += '</Workbook>';

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  downloadBlob(blob, `${filename}.xls`);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
