import React, { type ReactNode } from "react";

type PageSectionProps = Readonly<{
  title: string;
  description: string;
  children?: ReactNode;
  section?: string;
  actions?: ReactNode;
}>;

export function PageSection({
  title,
  description,
  children,
  section = "Workspace",
  actions,
}: PageSectionProps) {
  return (
    <section className="page-section">
      <header className="page-section__header">
        <div className="page-container page-section__header-inner">
          <div className="page-section__heading">
            <p className="page-section__eyebrow">{section}</p>
            <h1>{title}</h1>
          </div>
          <div className="page-section__summary">
            <p className="page-section__description">{description}</p>
            {actions ? <div className="page-section__actions">{actions}</div> : null}
          </div>
        </div>
      </header>
      {children ? <div className="page-container page-section__body">{children}</div> : null}
    </section>
  );
}
