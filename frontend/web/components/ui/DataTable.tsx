import React from "react";

type DataTableProps = Readonly<{
  density?: "regular" | "compact";
  children: React.ReactNode;
  caption?: string;
}>;

export function DataTable({
  density = "regular",
  children,
  caption,
}: DataTableProps) {
  const className = density === "compact" ? "data-table data-table--compact" : "data-table";

  return (
    <div className="data-table__scroll">
      <table className={className}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
