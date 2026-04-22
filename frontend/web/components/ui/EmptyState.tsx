import React from "react";

type EmptyStateProps = Readonly<{
  title: string;
  description: string;
  action?: React.ReactNode;
}>;

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <div className="empty-state__copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </section>
  );
}
