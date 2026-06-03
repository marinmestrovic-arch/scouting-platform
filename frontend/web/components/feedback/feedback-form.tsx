"use client";

import { useActionState, useRef } from "react";
import { submitFeedback } from "../../app/(authenticated)/feedback/actions";
import { FEEDBACK_INITIAL_STATE, type FeedbackActionState } from "../../lib/feedback-flow";

const CATEGORIES = [
  { value: "bug", label: "Bug report" },
  { value: "feature", label: "Feature request" },
  { value: "ux", label: "UI / UX improvement" },
  { value: "general", label: "General feedback" },
  { value: "other", label: "Other" },
] as const;

const RATINGS = [1, 2, 3, 4, 5] as const;

const RATING_LABELS: Record<number, string> = {
  1: "Very dissatisfied",
  2: "Dissatisfied",
  3: "Neutral",
  4: "Satisfied",
  5: "Very satisfied",
};

function resolveStatusClass(state: FeedbackActionState): string {
  if (state.status === "success") return "feedback-form__status--success";
  if (state.status === "error") return "feedback-form__status--error";
  return "feedback-form__status--idle";
}

export function FeedbackForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isSubmitting] = useActionState(
    async (prev: FeedbackActionState, formData: FormData) => {
      const result = await submitFeedback(prev, formData);
      if (result.status === "success") {
        formRef.current?.reset();
      }
      return result;
    },
    FEEDBACK_INITIAL_STATE
  );

  return (
    <form
      action={formAction}
      className="feedback-form"
      noValidate
      ref={formRef}
    >
      <div className="feedback-form__field">
        <label className="feedback-form__label" htmlFor="feedback-category">
          Category <span aria-hidden="true" className="feedback-form__required">*</span>
        </label>
        <select
          className="feedback-form__select"
          defaultValue=""
          disabled={isSubmitting}
          id="feedback-category"
          name="category"
          required
        >
          <option disabled value="">Select a category…</option>
          {CATEGORIES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <div className="feedback-form__field">
        <label className="feedback-form__label" htmlFor="feedback-message">
          Message <span aria-hidden="true" className="feedback-form__required">*</span>
        </label>
        <textarea
          className="feedback-form__textarea"
          disabled={isSubmitting}
          id="feedback-message"
          maxLength={2000}
          minLength={10}
          name="message"
          placeholder="Tell us what you think, what's broken, or what you'd love to see…"
          required
          rows={6}
        />
      </div>

      <fieldset className="feedback-form__rating-fieldset">
        <legend className="feedback-form__label">
          Overall satisfaction <span className="feedback-form__optional">(optional)</span>
        </legend>
        <div className="feedback-form__rating" role="group">
          {RATINGS.map((n) => (
            <label
              className="feedback-form__rating-option"
              key={n}
              title={RATING_LABELS[n]}
            >
              <input
                className="feedback-form__rating-input"
                disabled={isSubmitting}
                name="rating"
                type="radio"
                value={String(n)}
              />
              <span aria-hidden="true" className="feedback-form__star">★</span>
              <span className="sr-only">{RATING_LABELS[n]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.status !== "idle" ? (
        <p
          aria-live="polite"
          className={`feedback-form__status ${resolveStatusClass(state)}`}
          role={state.status === "error" ? "alert" : undefined}
        >
          {state.status === "success"
            ? "Thanks for your feedback — we read every submission."
            : state.status === "error"
            ? state.message
            : null}
        </p>
      ) : null}

      <div className="feedback-form__footer">
        <button
          className="feedback-form__submit"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Sending…" : "Send feedback"}
        </button>
      </div>
    </form>
  );
}
