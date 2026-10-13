import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { List as ReactWindowList } from "react-window";

import type { LibrarySection } from "../section-registry";

const virtualRows = Array.from({ length: 200 }, (_, rowIndex) => `row ${rowIndex}`);

const TanstackVirtualSection = () => {
  const scrollParentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: virtualRows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 24,
  });
  return (
    <div ref={scrollParentRef} style={{ height: 120, overflow: "auto" }}>
      <div
        data-testid="tanstack-virtual-inner"
        style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {virtualRows[virtualItem.index]}
          </div>
        ))}
      </div>
    </div>
  );
};

const ReactWindowRow = ({ index, style }: { index: number; style: React.CSSProperties }) => (
  <div style={style}>{virtualRows[index]}</div>
);

const ReactWindowSection = () => (
  <ReactWindowList
    rowComponent={ReactWindowRow}
    rowCount={virtualRows.length}
    rowHeight={24}
    rowProps={{}}
    style={{ height: 120, width: 200 }}
  />
);

interface TableRow {
  library: string;
  stars: number;
}

const tableRows: TableRow[] = [
  { library: "react", stars: 200 },
  { library: "bippy", stars: 100 },
];
const columnHelper = createColumnHelper<TableRow>();
const tableColumns = [
  columnHelper.accessor("library", { header: "library" }),
  columnHelper.accessor("stars", { header: "stars" }),
];

const TanstackTableSection = () => {
  const table = useReactTable({
    data: tableRows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <table data-testid="tanstack-table">
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const virtualTableSections: LibrarySection[] = [
  { name: "tanstack-virtual", Component: TanstackVirtualSection },
  { name: "react-window", Component: ReactWindowSection },
  { name: "tanstack-table", Component: TanstackTableSection },
];
