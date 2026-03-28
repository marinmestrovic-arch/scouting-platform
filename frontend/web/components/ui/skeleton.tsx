import React from "react";

type SkeletonProps = Readonly<{
  width?: string;
  height?: string;
  borderRadius?: string;
  className?: string;
}>;

export function Skeleton({ width, height, borderRadius, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={className ? `skeleton ${className}` : "skeleton"}
      style={{
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
        ...(borderRadius ? { borderRadius } : {}),
      }}
    />
  );
}

export function SkeletonText({ width = "100%", lines = 1 }: Readonly<{ width?: string; lines?: number }>) {
  return (
    <span aria-hidden="true" className="skeleton-text" style={{ width }}>
      {Array.from({ length: lines }, (_, i) => (
        <span className="skeleton skeleton-text__line" key={i} />
      ))}
    </span>
  );
}

export function SkeletonTableRow({ columns }: Readonly<{ columns: number }>) {
  return (
    <tr aria-hidden="true">
      {Array.from({ length: columns }, (_, i) => (
        <td key={i}>
          <Skeleton height="1rem" width={i === 0 ? "70%" : "50%"} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ columns, rows = 5 }: Readonly<{ columns: number; rows?: number }>) {
  return (
    <div className="skeleton-table">
      <table className="skeleton-table__table">
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, i) => (
              <th key={i}>
                <Skeleton height="0.75rem" width="60%" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <SkeletonTableRow columns={columns} key={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonFilterBar({ filters = 3 }: Readonly<{ filters?: number }>) {
  return (
    <div className="skeleton-filter-bar">
      {Array.from({ length: filters }, (_, i) => (
        <div className="skeleton-filter-bar__item" key={i}>
          <Skeleton height="0.7rem" width="5rem" />
          <Skeleton borderRadius="var(--radius-md)" height="2.25rem" width="100%" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPageBody({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div aria-busy="true" className="skeleton-page-body" role="status">
      <span className="sr-only">Loading...</span>
      {children}
    </div>
  );
}
