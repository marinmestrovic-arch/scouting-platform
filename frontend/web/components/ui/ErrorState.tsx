import React from "react";

type ErrorStateProps = Readonly<{
  title: string;
  description: string;
  onRetry?: () => void;
}>;

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  return (
    <section className="error-state" role="alert">
      <div className="error-state__copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {onRetry ? (
        <button className="workspace-button" onClick={onRetry} type="button">
          Retry
        </button>
      ) : null}
    </section>
  );
}
