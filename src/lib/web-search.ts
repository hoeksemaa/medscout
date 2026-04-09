import type { WebSearchResult } from "./types";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export async function webSearch(
  query: string,
  apiKey: string
): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** (attempt - 1)));
    }

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (res.ok) {
      const json = await res.json();
      const results = json.web?.results;
      if (!results || !Array.isArray(results)) return [];
      return results.map(
        (item: { title?: string; description?: string; url?: string }) => ({
          title: item.title ?? "",
          snippet: item.description ?? "",
          link: item.url ?? "",
        })
      );
    }

    const text = await res.text();
    lastError = new Error(`Brave Search API error (${res.status}): ${text}`);

    // Only retry on rate limit (429) or server errors (5xx)
    if (res.status !== 429 && res.status < 500) throw lastError;
  }

  throw lastError!;
}

export function formatSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title}\n    ${r.snippet}\n    URL: ${r.link}`
    )
    .join("\n\n");
}
