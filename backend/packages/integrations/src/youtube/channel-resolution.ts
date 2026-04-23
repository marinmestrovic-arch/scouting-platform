import { z } from "zod";

const CHANNEL_ID_PATTERN = /^UC[a-zA-Z0-9_-]{22}$/u;
const CHANNEL_ID_SEARCH_PATTERN = /(UC[a-zA-Z0-9_-]{22})/u;
const YOUTUBE_URL_PATTERN = /(?:youtu\.be|youtube\.com)/iu;
const YOUTUBE_HANDLE_PATTERN = /^@[\w.-]+$/u;
const YT_SKIP_PATHS = new Set(["watch", "shorts", "playlist", "results", "feed"]);
const YT_CHANNEL_ID_PATTERNS = [
  /"channelId":"(UC[a-zA-Z0-9_-]{22})"/u,
  /"externalId":"(UC[a-zA-Z0-9_-]{22})"/u,
  /"browseId":"(UC[a-zA-Z0-9_-]{22})"/u,
  /<meta\s+itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]{22})"/iu,
  /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/iu,
] as const;

const resolveInputSchema = z.object({
  input: z.string().trim().min(1),
  apiKey: z.string().trim().min(1).optional(),
  channelName: z.string().trim().min(1).optional(),
});

type ResolveFromInputContext = {
  apiKey: string | null;
  depth: number;
};

function withHttps(value: string): string {
  return /^https?:\/\//iu.test(value) ? value : `https://${value}`;
}

function normalizeYoutubeHandle(value: string): string {
  const trimmed = value.trim().replace(/^https?:\/\/(?:www\.)?youtube\.com\//iu, "").replace(/^\/+/u, "");

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function buildCanonicalYoutubeUrl(channelId: string, handle: string | null): string {
  const normalizedHandle = handle ? normalizeYoutubeHandle(handle) : "";

  if (normalizedHandle) {
    return `https://www.youtube.com/${normalizedHandle}`;
  }

  return `https://www.youtube.com/channel/${channelId}`;
}

function normalizeChannelUrl(url: string): string {
  return url.trim().replace(/\s+/gu, "");
}

async function safeFetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { method: "GET" });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    return payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function safeFetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; scouting-platform)",
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

function getFirstItem(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!payload) {
    return null;
  }

  const items = payload.items;

  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const first = items[0];
  return first && typeof first === "object" ? first as Record<string, unknown> : null;
}

function getChannelIdFromItemId(item: Record<string, unknown> | null): string | null {
  if (!item) {
    return null;
  }

  const idValue = item.id;

  if (typeof idValue === "string" && CHANNEL_ID_PATTERN.test(idValue)) {
    return idValue;
  }

  if (idValue && typeof idValue === "object") {
    const channelId = (idValue as { channelId?: unknown }).channelId;

    if (typeof channelId === "string" && CHANNEL_ID_PATTERN.test(channelId)) {
      return channelId;
    }
  }

  const snippet = item.snippet;

  if (snippet && typeof snippet === "object") {
    const snippetChannelId = (snippet as { channelId?: unknown }).channelId;

    if (typeof snippetChannelId === "string" && CHANNEL_ID_PATTERN.test(snippetChannelId)) {
      return snippetChannelId;
    }
  }

  return null;
}

async function pickChannelIdFromSearch(query: string, apiKey: string | null): Promise<string | null> {
  if (!apiKey) {
    return null;
  }

  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return null;
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "channel",
    maxResults: "1",
    q: normalizedQuery,
    key: apiKey,
  });
  const payload = await safeFetchJson(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  const item = getFirstItem(payload);
  return getChannelIdFromItemId(item);
}

async function pickChannelIdFromUsername(username: string, apiKey: string | null): Promise<string | null> {
  if (!apiKey) {
    return null;
  }

  const normalizedUsername = username.trim();

  if (!normalizedUsername) {
    return null;
  }

  const params = new URLSearchParams({
    part: "id",
    forUsername: normalizedUsername,
    key: apiKey,
  });
  const payload = await safeFetchJson(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`);
  const item = getFirstItem(payload);
  return getChannelIdFromItemId(item);
}

async function pickChannelIdFromHandle(handle: string, apiKey: string | null): Promise<string | null> {
  if (!apiKey) {
    return null;
  }

  const cleanHandle = handle.replace(/^@+/u, "").trim();

  if (!cleanHandle) {
    return null;
  }

  const candidates = [cleanHandle, cleanHandle.toLowerCase()];

  for (const candidate of candidates) {
    const params = new URLSearchParams({
      part: "id",
      forHandle: candidate,
      key: apiKey,
    });
    const payload = await safeFetchJson(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`);
    const item = getFirstItem(payload);
    const channelId = getChannelIdFromItemId(item);

    if (channelId) {
      return channelId;
    }
  }

  return (
    await pickChannelIdFromSearch(`@${cleanHandle}`, apiKey)
    ?? await pickChannelIdFromSearch(cleanHandle, apiKey)
  );
}

async function channelIdFromPageHtml(channelUrl: string): Promise<string | null> {
  const base = channelUrl.replace(/\/+$/u, "");
  const urlsToTry = [base];

  if (!/\/about(?:\?|$)/iu.test(base) && !/\/(?:watch|shorts|playlist|results|feed)(?:\/|$)/iu.test(base)) {
    urlsToTry.push(`${base}/about`);
  }

  for (const url of urlsToTry) {
    const html = await safeFetchText(url);

    if (!html) {
      continue;
    }

    for (const pattern of YT_CHANNEL_ID_PATTERNS) {
      const match = html.match(pattern);

      if (match?.[1] && CHANNEL_ID_PATTERN.test(match[1])) {
        return match[1];
      }
    }
  }

  return null;
}

async function resolveYoutubeChannelIdFromInput(
  input: string,
  context: ResolveFromInputContext,
): Promise<{ channelId: string; canonicalUrl: string } | null> {
  const raw = input.trim();

  if (!raw) {
    return null;
  }

  if (CHANNEL_ID_PATTERN.test(raw)) {
    return {
      channelId: raw,
      canonicalUrl: buildCanonicalYoutubeUrl(raw, null),
    };
  }

  if (YOUTUBE_HANDLE_PATTERN.test(raw)) {
    const channelId = await pickChannelIdFromHandle(raw, context.apiKey);

    if (channelId) {
      return {
        channelId,
        canonicalUrl: buildCanonicalYoutubeUrl(channelId, raw),
      };
    }
  }

  const normalizedUrl = withHttps(raw);

  if (!YOUTUBE_URL_PATTERN.test(normalizedUrl)) {
    return null;
  }

  const directIdMatch = normalizedUrl.match(CHANNEL_ID_SEARCH_PATTERN);

  if (directIdMatch?.[1] && CHANNEL_ID_PATTERN.test(directIdMatch[1])) {
    return {
      channelId: directIdMatch[1],
      canonicalUrl: buildCanonicalYoutubeUrl(directIdMatch[1], null),
    };
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    return null;
  }

  const host = parsedUrl.hostname.replace(/^www\./iu, "").toLowerCase();

  if (!host.endsWith("youtube.com") && !host.endsWith("youtu.be")) {
    return null;
  }

  const pathParts = parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });

  const first = pathParts[0] ?? "";
  const second = pathParts[1] ?? "";
  const firstLower = first.toLowerCase();

  const resolveByNameOrFallback = async (name: string): Promise<string | null> =>
    (await pickChannelIdFromUsername(name, context.apiKey))
    ?? (await pickChannelIdFromSearch(name, context.apiKey))
    ?? (await channelIdFromOembed(normalizedUrl, context))
    ?? (await channelIdFromPageHtml(normalizedUrl));

  if (first.startsWith("@")) {
    const channelId = (await pickChannelIdFromHandle(first, context.apiKey))
      ?? (await channelIdFromOembed(normalizedUrl, context))
      ?? (await channelIdFromPageHtml(normalizedUrl));

    if (channelId) {
      return {
        channelId,
        canonicalUrl: buildCanonicalYoutubeUrl(channelId, first),
      };
    }

    return null;
  }

  if (firstLower === "channel" && CHANNEL_ID_PATTERN.test(second)) {
    return {
      channelId: second,
      canonicalUrl: buildCanonicalYoutubeUrl(second, null),
    };
  }

  if ((firstLower === "user" || firstLower === "c") && second) {
    const channelId = await resolveByNameOrFallback(second);

    if (channelId) {
      return {
        channelId,
        canonicalUrl: buildCanonicalYoutubeUrl(channelId, null),
      };
    }

    return null;
  }

  if (first && !YT_SKIP_PATHS.has(firstLower)) {
    const channelId = await resolveByNameOrFallback(first);

    if (channelId) {
      return {
        channelId,
        canonicalUrl: buildCanonicalYoutubeUrl(channelId, first),
      };
    }

    return null;
  }

  const fallbackChannelId =
    await channelIdFromOembed(normalizedUrl, context) ?? await channelIdFromPageHtml(normalizedUrl);

  if (!fallbackChannelId) {
    return null;
  }

  return {
    channelId: fallbackChannelId,
    canonicalUrl: buildCanonicalYoutubeUrl(fallbackChannelId, null),
  };
}

async function channelIdFromOembed(url: string, context: ResolveFromInputContext): Promise<string | null> {
  if (context.depth > 1) {
    return null;
  }

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const payload = await safeFetchJson(oembedUrl);

  if (!payload) {
    return null;
  }

  const authorUrl = typeof payload.author_url === "string" ? payload.author_url.trim() : "";

  if (!authorUrl || authorUrl === url) {
    return null;
  }

  const resolved = await resolveYoutubeChannelIdFromInput(authorUrl, {
    ...context,
    depth: context.depth + 1,
  });
  return resolved?.channelId ?? null;
}

function normalizeMatchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9@]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isStrongYoutubeChannelMatch(query: string, title: string): boolean {
  const queryNorm = normalizeMatchText(query);
  const titleNorm = normalizeMatchText(title);

  if (!queryNorm || !titleNorm) {
    return false;
  }

  if (queryNorm === titleNorm) {
    return true;
  }

  const queryTight = queryNorm.replace(/\s+/gu, "");
  const titleTight = titleNorm.replace(/\s+/gu, "");

  if (queryTight === titleTight) {
    return true;
  }

  if (queryNorm.length >= 6 && (titleNorm.includes(queryNorm) || queryNorm.includes(titleNorm))) {
    return true;
  }

  const queryTokens = queryNorm.split(" ").filter((token) => token.length > 2 && token !== "official");

  if (queryTokens.length < 2) {
    return false;
  }

  const titleTokens = new Set(
    titleNorm.split(" ").filter((token) => token.length > 2 && token !== "official"),
  );
  const overlap = queryTokens.filter((token) => titleTokens.has(token)).length;

  return overlap === queryTokens.length;
}

async function findStrongYoutubeChannelMatchByName(
  channelName: string,
  apiKey: string | null,
): Promise<{ channelId: string; canonicalUrl: string } | null> {
  if (!apiKey) {
    return null;
  }

  const query = channelName.trim();

  if (!query) {
    return null;
  }

  const params = new URLSearchParams({
    part: "snippet",
    type: "channel",
    maxResults: "5",
    q: query,
    key: apiKey,
  });
  const payload = await safeFetchJson(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);

  if (!payload?.items || !Array.isArray(payload.items)) {
    return null;
  }

  for (const candidate of payload.items) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const item = candidate as Record<string, unknown>;
    const channelId = getChannelIdFromItemId(item);

    if (!channelId) {
      continue;
    }

    const snippet = item.snippet && typeof item.snippet === "object"
      ? item.snippet as { title?: unknown }
      : null;
    const title = typeof snippet?.title === "string" ? snippet.title.trim() : "";

    if (!isStrongYoutubeChannelMatch(query, title)) {
      continue;
    }

    return {
      channelId,
      canonicalUrl: buildCanonicalYoutubeUrl(channelId, null),
    };
  }

  return null;
}

export type ResolveYoutubeChannelForEnrichmentInput = z.input<typeof resolveInputSchema>;

export type ResolvedYoutubeChannel = {
  channelId: string;
  canonicalUrl: string;
};

export async function resolveYoutubeChannelForEnrichment(
  rawInput: ResolveYoutubeChannelForEnrichmentInput,
): Promise<ResolvedYoutubeChannel | null> {
  const parsed = resolveInputSchema.parse(rawInput);
  const apiKey = parsed.apiKey?.trim() ?? null;
  const direct = await resolveYoutubeChannelIdFromInput(parsed.input, {
    apiKey,
    depth: 0,
  });

  if (direct) {
    return {
      channelId: direct.channelId,
      canonicalUrl: normalizeChannelUrl(direct.canonicalUrl),
    };
  }

  if (parsed.channelName) {
    const byName = await findStrongYoutubeChannelMatchByName(parsed.channelName, apiKey);

    if (byName) {
      return {
        channelId: byName.channelId,
        canonicalUrl: normalizeChannelUrl(byName.canonicalUrl),
      };
    }
  }

  return null;
}
