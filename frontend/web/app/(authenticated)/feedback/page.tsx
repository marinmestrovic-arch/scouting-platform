import React from "react";
import { PageHeader } from "../../../components/layout/PageHeader";
import { FeedbackForm } from "../../../components/feedback/feedback-form";

export default function FeedbackPage() {
  return (
    <section className="page-section">
      <PageHeader
        crumbs={[{ label: "Feedback" }]}
        description="Help us improve the platform. Your feedback goes directly to the team."
        title="Give feedback"
      />
      <div className="page-container">
        <div className="feedback-page__body">
          <FeedbackForm />
        </div>
      </div>
    </section>
  );
}
