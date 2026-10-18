import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Table = ({ className, ...props }: ComponentProps<"table">) => (
  <table
    data-slot="table"
    className={cn("w-full border-collapse tabular-nums", className)}
    {...props}
  />
);

export const TableHeader = ({ className, ...props }: ComponentProps<"thead">) => (
  <thead data-slot="table-header" className={cn("text-left", className)} {...props} />
);

export const TableBody = ({ className, ...props }: ComponentProps<"tbody">) => (
  <tbody
    data-slot="table-body"
    className={cn("[&>tr:last-child]:border-b", className)}
    {...props}
  />
);

export const TableRow = ({ className, ...props }: ComponentProps<"tr">) => (
  <tr data-slot="table-row" className={cn("border-t", className)} {...props} />
);

export const TableHead = ({ className, ...props }: ComponentProps<"th">) => (
  <th
    data-slot="table-head"
    className={cn(
      "pr-4 pb-2 text-left align-top font-normal whitespace-nowrap text-muted-foreground last:pr-0",
      className,
    )}
    {...props}
  />
);

export const TableCell = ({ className, ...props }: ComponentProps<"td">) => (
  <td
    data-slot="table-cell"
    className={cn("py-2 pr-4 align-top text-text-2 last:pr-0", className)}
    {...props}
  />
);
