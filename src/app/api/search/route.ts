import Anthropic from "@anthropic-ai/sdk";

// Allow up to 5 minutes for the full discovery + vetting + scoring pipeline
export const maxDuration = 300;

import { webSearch, formatSearchResults } from "@/lib/google-search";
import {
  SYSTEM_PROMPT,
  WEB_SEARCH_TOOL,
  buildDiscoveryMessage,
  buildScoringMessage,
} from "@/lib/prompts";
import { formatGeography } from "@/lib/countries";
import { createClient } from "@/lib/supabase/server";
import type { Candidate, SearchResponse, SSEEvent } from "@/lib/types";

function sendSSE(
  controller: ReadableStreamDefaultController,
  event: SSEEvent
): void {
  const encoder = new TextEncoder();
  const data = JSON.stringify(event);
  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
}

function parseCandidatesFromResponse(text: string): Candidate[] {
  let raw: Candidate[];

  const candidatesMatch = text.match(
    /<candidates>\s*([\s\S]*?)\s*<\/candidates>/
  );
  if (candidatesMatch) {
    raw = JSON.parse(candidatesMatch[1]);
  } else {
    const resultsMatch = text.match(/<results>\s*([\s\S]*?)\s*<\/results>/);
    if (resultsMatch) {
      raw = JSON.parse(resultsMatch[1]);
    } else {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        raw = JSON.parse(jsonMatch[0]);
      } else {
        const preview = text.slice(0, 500).replace(/\n/g, " ");
        throw new Error(`Could not parse candidates. Model returned: ${preview}`);
      }
    }
  }

  return raw.map((c) => ({
    ...c,
    status: c.status || "accepted",
  }));
}

async function runDiscoveryPhase(
  client: Anthropic,
  procedure: string,
  geography: string | null,
  resultCount: number,
  searchKey: string,
  sendProgress: (event: SSEEvent) => void
): Promise<{ candidates: Candidate[]; searchCount: number; durationMs: number }> {
  let searchCount = 0;
  const start = Date.now();

  sendProgress({
    type: "progress",
    phase: "discovery",
    message: `Searching for "${procedure}" specialists...`,
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildDiscoveryMessage(procedure, geography, resultCount) },
  ];

  let response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [WEB_SEARCH_TOOL],
    messages,
  });

  while (response.stop_reason === "tool_use") {
    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of assistantContent) {
      if (block.type === "tool_use" && block.name === "web_search") {
        const query = (block.input as { query: string }).query;
        searchCount++;
        sendProgress({
          type: "progress",
          phase: "discovery",
          message: `Search ${searchCount}: "${query.slice(0, 80)}${query.length > 80 ? "..." : ""}"`,
        });

        try {
          const results = await webSearch(query, searchKey);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: formatSearchResults(results),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Search error: ${err instanceof Error ? err.message : "Unknown error"}`,
            is_error: true,
          });
        }
      }
    }

    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [WEB_SEARCH_TOOL],
      messages,
    });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const candidates = parseCandidatesFromResponse(text);

  sendProgress({
    type: "progress",
    phase: "discovery",
    message: `Found ${candidates.length} candidates. Starting verification...`,
  });

  return { candidates, searchCount, durationMs: Date.now() - start };
}

async function runVettingPhase(
  candidates: Candidate[],
  procedure: string,
  searchKey: string,
  sendProgress: (event: SSEEvent) => void
): Promise<{ vettingResults: Record<string, string>; searchCount: number; durationMs: number }> {
  const vettingResults: Record<string, string> = {};
  let searchCount = 0;
  const start = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const query = `"${c.name}" "${c.institution}" ${procedure}`;

    sendProgress({
      type: "progress",
      phase: "vetting",
      message: `Vetting ${c.name}...`,
      current: i + 1,
      total: candidates.length,
    });

    try {
      const results = await webSearch(query, searchKey);
      searchCount++;
      vettingResults[c.name] = formatSearchResults(results);
    } catch {
      vettingResults[c.name] = "Verification search failed.";
    }
  }

  return { vettingResults, searchCount, durationMs: Date.now() - start };
}

async function runScoringPhase(
  client: Anthropic,
  candidates: Candidate[],
  vettingResults: Record<string, string>,
  resultCount: number,
  sendProgress: (event: SSEEvent) => void
): Promise<{ scored: Candidate[]; durationMs: number }> {
  const start = Date.now();

  sendProgress({
    type: "progress",
    phase: "scoring",
    message: "Scoring and ranking candidates...",
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildScoringMessage(candidates, vettingResults, resultCount),
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return { scored: parseCandidatesFromResponse(text), durationMs: Date.now() - start };
}

interface SearchRequestBody {
  procedure: string;
  region?: string;
  countries?: string[];
  resultCount?: number;
}

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const braveSearchKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!anthropicKey || !braveSearchKey) {
    return Response.json(
      { error: "Server API keys not configured" },
      { status: 500 }
    );
  }

  let body: SearchRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { procedure, region, countries, resultCount = 20 } = body;

  if (!procedure) {
    return Response.json(
      { error: "Missing required field: procedure" },
      { status: 400 }
    );
  }

  const geography = formatGeography(region, countries);
  const totalStart = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => sendSSE(controller, event);

      try {
        const client = new Anthropic({ apiKey: anthropicKey });

        // Phase 1: Discovery
        const { candidates: rawCandidates, searchCount: discoverySearches, durationMs: discoveryMs } =
          await runDiscoveryPhase(client, procedure, geography, resultCount, braveSearchKey, send);

        if (rawCandidates.length === 0) {
          await supabase.from("searches").insert({
            user_id: user.id,
            procedure,
            geography,
            result_count: 0,
            results_json: [],
            discovery_searches: discoverySearches,
            vetting_searches: 0,
            candidates_dropped: 0,
            duration_total_ms: Date.now() - totalStart,
            duration_discovery_ms: discoveryMs,
            error_type: "no_results",
          });

          send({
            type: "error",
            message: "No candidates found. Try a different procedure name or broader geographic filter.",
          });
          send({ type: "done" });
          controller.close();
          return;
        }

        // Phase 2: Vetting
        const { vettingResults, searchCount: vettingSearches, durationMs: vettingMs } =
          await runVettingPhase(rawCandidates, procedure, braveSearchKey, send);

        // Phase 3: Scoring
        const { scored: finalCandidates, durationMs: scoringMs } =
          await runScoringPhase(client, rawCandidates, vettingResults, resultCount, send);

        const totalMs = Date.now() - totalStart;

        const responseData: SearchResponse = {
          candidates: finalCandidates,
          metadata: {
            procedure,
            geography,
            totalDiscoverySearches: discoverySearches,
            totalVettingSearches: vettingSearches,
            candidatesDropped: rawCandidates.length - finalCandidates.length,
            timestamp: new Date().toISOString(),
          },
        };

        // Store in DB
        const { data: searchRow } = await supabase
          .from("searches")
          .insert({
            user_id: user.id,
            procedure,
            geography,
            result_count: finalCandidates.length,
            results_json: finalCandidates,
            discovery_searches: discoverySearches,
            vetting_searches: vettingSearches,
            candidates_dropped: rawCandidates.length - finalCandidates.length,
            duration_total_ms: totalMs,
            duration_discovery_ms: discoveryMs,
            duration_vetting_ms: vettingMs,
            duration_scoring_ms: scoringMs,
          })
          .select("id")
          .single();

        send({
          type: "result",
          data: responseData,
          searchId: searchRow?.id ?? null,
        });

        send({ type: "done" });
      } catch (err) {
        await supabase.from("searches").insert({
          user_id: user.id,
          procedure,
          geography,
          result_count: 0,
          results_json: [],
          duration_total_ms: Date.now() - totalStart,
          error_type: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        });

        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error occurred",
        });
        send({ type: "done" });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
