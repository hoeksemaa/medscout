import type { WebSearchResult } from "./types";

export async function webSearch(
  query: string,
  apiKey: string
): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brave Search API error (${res.status}): ${text}`);
  }

  const json = await res.json();

  const results = json.web?.results;
  if (!results || !Array.isArray(results)) {
    return [];
  }

  return results.map(
    (item: { title?: string; description?: string; url?: string }) => ({
      title: item.title ?? "",
      snippet: item.description ?? "",
      link: item.url ?? "",
    })
  );
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
