export type FeedbackCategory =
  | "bug"
  | "feature"
  | "ux"
  | "general"
  | "other";

export type FeedbackActionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

export const FEEDBACK_INITIAL_STATE: FeedbackActionState = { status: "idle" };

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  "bug",
  "feature",
  "ux",
  "general",
  "other",
];

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === "string" && FEEDBACK_CATEGORIES.includes(value as FeedbackCategory);
}
