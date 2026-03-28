import { cache } from "react";
import { auth } from "../auth";

/**
 * Request-scoped cached version of auth().
 *
 * In the App Router, `layout.tsx` and `page.tsx` both call `auth()` within
 * the same request.  Without deduplication each call independently verifies
 * the JWT.  `React.cache` ensures the work happens only once per request
 * while every call-site still gets the resolved session.
 */
export const getSession = cache(() => auth());
