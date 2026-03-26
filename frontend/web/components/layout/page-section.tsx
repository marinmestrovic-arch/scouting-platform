import React, { type ReactNode } from "react";

type PageSectionProps = Readonly<{
  title: string;
  description: string;
  children?: ReactNode;
}>;

export function PageSection({ title, description, children }: PageSectionProps) {
  return (
    <section className="page-section">
      <header className="page-section__header">
        <div className="page-section__heading">
          <p className="page-section__eyebrow">Workspace</p>
          <h1>{title}</h1>
        </div>
        <p className="page-section__description">{description}</p>
      </header>
      {children ? <div className="page-section__body">{children}</div> : null}
    </section>
  );
}
