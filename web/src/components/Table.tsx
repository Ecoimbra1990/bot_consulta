import type { ReactNode } from 'react';

export interface TableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  empty?: string;
}

export function Table<T>({ columns, rows, rowKey, empty = 'Nenhum registro encontrado.' }: TableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-800/70 text-xs uppercase tracking-wide text-slate-300">
          <tr>
            {columns.map((column) => (
              <th key={column.header} className={`whitespace-nowrap px-4 py-3 font-semibold ${column.className ?? ''}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-400">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="hover:bg-slate-800/40">
                {columns.map((column) => (
                  <td key={column.header} className={`px-4 py-3 align-top ${column.className ?? ''}`}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
