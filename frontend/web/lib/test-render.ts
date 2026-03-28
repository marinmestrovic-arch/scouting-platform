import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";

/**
 * Renders a React element to a full HTML string, resolving all Suspense
 * boundaries.  Use this in page-level tests that wrap content in Suspense.
 *
 * Unlike `renderToStaticMarkup`, this waits for every lazy / async
 * component to resolve before returning.
 */
export async function renderToStringAsync(element: ReactNode): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  const reader = stream.getReader();
  const chunks: string[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new TextDecoder().decode(value));
  }

  return chunks.join("");
}
