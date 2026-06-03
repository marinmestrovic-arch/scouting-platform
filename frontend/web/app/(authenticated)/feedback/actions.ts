"use server";

import {
  isFeedbackCategory,
  type FeedbackActionState,
  type FeedbackCategory,
} from "../../../lib/feedback-flow";

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "Bug report",
  feature: "Feature request",
  ux: "UI / UX improvement",
  general: "General feedback",
  other: "Other",
};

export async function submitFeedback(
  _previousState: FeedbackActionState,
  formData: FormData
): Promise<FeedbackActionState> {
  const category = formData.get("category");
  const message = formData.get("message");
  const rating = formData.get("rating");

  if (!isFeedbackCategory(category)) {
    return { status: "error", message: "Please select a feedback category." };
  }

  const messageStr = typeof message === "string" ? message.trim() : "";
  if (!messageStr || messageStr.length < 10) {
    return { status: "error", message: "Please write at least 10 characters of feedback." };
  }

  if (messageStr.length > 2000) {
    return { status: "error", message: "Feedback must be 2000 characters or fewer." };
  }

  const ratingNum = typeof rating === "string" && rating !== "" ? parseInt(rating, 10) : null;
  if (ratingNum !== null && (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5)) {
    return { status: "error", message: "Rating must be between 1 and 5." };
  }

  const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("[feedback] SLACK_FEEDBACK_WEBHOOK_URL is not set");
    return { status: "error", message: "Feedback could not be sent. Please try again later." };
  }

  const stars = ratingNum ? "★".repeat(ratingNum) + "☆".repeat(5 - ratingNum) : null;

  const slackBody = {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New app feedback", emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Category*\n${CATEGORY_LABELS[category]}` },
          ...(stars ? [{ type: "mrkdwn", text: `*Rating*\n${stars}` }] : []),
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Message*\n${messageStr}` },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `Submitted at ${new Date().toUTCString()}` },
        ],
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(slackBody),
  });

  if (!response.ok) {
    console.error("[feedback] Slack webhook failed", response.status);
    return { status: "error", message: "Feedback could not be sent. Please try again later." };
  }

  return { status: "success" };
}
