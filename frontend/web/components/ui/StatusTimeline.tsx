import React from "react";

type StatusTimelineStep = Readonly<{
  key: string;
  label: string;
  state: "todo" | "active" | "done";
}>;

type StatusTimelineProps = Readonly<{
  steps: readonly StatusTimelineStep[];
}>;

export function StatusTimeline({ steps }: StatusTimelineProps) {
  return (
    <div aria-label="Status timeline" className="timeline">
      {steps.map((step, index) => {
        const stepClassName =
          step.state === "done"
            ? "timeline__step timeline__step--done"
            : step.state === "active"
              ? "timeline__step timeline__step--active"
              : "timeline__step";

        return (
          <React.Fragment key={step.key}>
            <div className={stepClassName}>
              <span aria-hidden="true" className="timeline__marker" />
              <span>{step.label}</span>
            </div>
            {index < steps.length - 1 ? <span aria-hidden="true" className="timeline__connector" /> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
