function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim();
  return first || null;
}

function validForwardedOrigin(protocol: string, host: string): string | null {
  if (protocol !== "http" && protocol !== "https") {
    return null;
  }

  // A forwarded host is used only for signature input. Still reject characters
  // that could turn it into credentials, a path, or another header value.
  if (!host || /[\s/@?#\\]/.test(host)) {
    return null;
  }

  try {
    const parsed = new URL(`${protocol}://${host}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
  } catch {
    return null;
  }

  // Keep the validated header spelling and explicit port exactly as supplied;
  // HubSpot signs the externally visible URI, not a normalized internal URL.
  return `${protocol}://${host}`;
}

/**
 * Reconstruct the URI HubSpot saw before a trusted reverse proxy rewrote its
 * origin. Invalid/incomplete forwarding metadata is ignored as a pair.
 */
export function getHubspotExternalRequestUri(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProtocol = firstForwardedValue(
    request.headers.get("x-forwarded-proto"),
  )?.toLowerCase();
  const forwardedHost = firstForwardedValue(
    request.headers.get("x-forwarded-host"),
  );

  if (!forwardedProtocol || !forwardedHost) {
    return request.url;
  }

  const forwardedOrigin = validForwardedOrigin(
    forwardedProtocol,
    forwardedHost,
  );

  return forwardedOrigin
    ? `${forwardedOrigin}${requestUrl.pathname}${requestUrl.search}`
    : request.url;
}
