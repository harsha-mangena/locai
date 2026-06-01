/**
 * Web Search Tool — queries SearXNG or DuckDuckGo for web results.
 * Never throws. All errors are returned as structured JSON strings.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6
 */

import type { ToolDefinition } from "./registry.ts";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Strip HTML tags from a string using a simple regex.
 * No external dependencies required.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Query SearXNG JSON API.
 */
async function querySearXNG(
  baseUrl: string,
  query: string,
  numResults: number,
  signal: AbortSignal
): Promise<SearchResult[]> {
  const url = new URL(baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(`SearXNG returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const results: SearchResult[] = [];

  if (Array.isArray(data.results)) {
    for (const item of data.results.slice(0, numResults)) {
      results.push({
        title: stripHtml(item.title ?? ""),
        url: item.url ?? "",
        snippet: stripHtml(item.content ?? item.snippet ?? ""),
      });
    }
  }

  return results;
}

/**
 * Query DuckDuckGo Instant Answers API.
 */
async function queryDuckDuckGo(
  query: string,
  numResults: number,
  signal: AbortSignal
): Promise<SearchResult[]> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const results: SearchResult[] = [];

  // DuckDuckGo Instant Answers returns results in several fields
  // Abstract is the main result
  if (data.Abstract && data.AbstractURL) {
    results.push({
      title: stripHtml(data.Heading ?? ""),
      url: data.AbstractURL,
      snippet: stripHtml(data.Abstract),
    });
  }

  // RelatedTopics contains additional results
  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      if (results.length >= numResults) break;

      if (topic.FirstURL && topic.Text) {
        results.push({
          title: stripHtml(topic.Text.split(" - ")[0] ?? topic.Text),
          url: topic.FirstURL,
          snippet: stripHtml(topic.Text),
        });
      }

      // Some topics are grouped under a "Topics" sub-array
      if (Array.isArray(topic.Topics)) {
        for (const subTopic of topic.Topics) {
          if (results.length >= numResults) break;
          if (subTopic.FirstURL && subTopic.Text) {
            results.push({
              title: stripHtml(
                subTopic.Text.split(" - ")[0] ?? subTopic.Text
              ),
              url: subTopic.FirstURL,
              snippet: stripHtml(subTopic.Text),
            });
          }
        }
      }
    }
  }

  // Results field (rare but possible)
  if (Array.isArray(data.Results)) {
    for (const item of data.Results) {
      if (results.length >= numResults) break;
      if (item.FirstURL && item.Text) {
        results.push({
          title: stripHtml(item.Text.split(" - ")[0] ?? item.Text),
          url: item.FirstURL,
          snippet: stripHtml(item.Text),
        });
      }
    }
  }

  return results.slice(0, numResults);
}

/**
 * Creates the web_search tool definition for registration in the ToolRegistry.
 *
 * Backend selection:
 * - SEARXNG_URL env set → SearXNG JSON API
 * - Otherwise → DuckDuckGo Instant Answers API
 *
 * Enforces a 10s timeout via AbortController.
 * Never throws — returns structured error JSON on failure.
 */
export function makeWebSearchTool(): ToolDefinition {
  return {
    name: "web_search",
    description:
      "Search the web for current information. Returns a JSON array of results with title, URL, and snippet.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query string.",
        },
        num_results: {
          type: "integer",
          description:
            "Number of results to return (1-10). Defaults to 5.",
          default: 5,
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["query"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      try {
        const query = String(args.query ?? "");
        if (!query) {
          return JSON.stringify({
            error: "invalid_query",
            message: "The 'query' parameter is required and must be non-empty.",
          });
        }

        const numResults = Math.min(
          Math.max(1, Number(args.num_results) || 5),
          10
        );

        // 10s timeout via AbortController
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        try {
          const searxngUrl = process.env.SEARXNG_URL;
          let results: SearchResult[];

          if (searxngUrl) {
            results = await querySearXNG(
              searxngUrl,
              query,
              numResults,
              controller.signal
            );
          } else {
            results = await queryDuckDuckGo(
              query,
              numResults,
              controller.signal
            );
          }

          return JSON.stringify(results);
        } finally {
          clearTimeout(timeout);
        }
      } catch (err: unknown) {
        // Never throw — return structured error
        if (
          err instanceof Error &&
          err.name === "AbortError"
        ) {
          return JSON.stringify({
            error: "timeout",
            message: "Search request timed out after 10 seconds.",
          });
        }

        return JSON.stringify({
          error: "search_failed",
          message:
            err instanceof Error ? err.message : "An unknown error occurred.",
        });
      }
    },
  };
}
