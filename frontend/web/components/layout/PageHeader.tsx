import Link from "next/link";
import React from "react";

type PageHeaderCrumb = Readonly<{
  label: string;
  href?: string;
}>;

type PageHeaderProps = Readonly<{
  title: string;
  description?: string;
  crumbs: readonly PageHeaderCrumb[];
  actions?: React.ReactNode;
  live?: boolean;
}>;

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
  live = false,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-container page-header__inner">
        <div className="page-header__copy">
          <nav aria-label="Breadcrumb" className="page-header__crumbs">
            <ol>
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`}>
                  {crumb.href && index < crumbs.length - 1 ? <Link href={crumb.href}>{crumb.label}</Link> : <span>{crumb.label}</span>}
                </li>
              ))}
            </ol>
          </nav>

          <div className="page-header__title-row">
            <h1 className="page-header__title">{title}</h1>
            {live ? (
              <span aria-live="polite" className="page-header__live" role="status">
                <span aria-hidden="true" className="status-pill__dot" />
                <span>Updating...</span>
              </span>
            ) : null}
          </div>

          {description ? <p className="page-header__description">{description}</p> : null}
        </div>

        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </header>
  );
}
