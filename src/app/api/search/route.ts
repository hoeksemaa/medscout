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
import type { Candidate, SearchRequest, SSEEvent } from "@/lib/types";

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

  // Try <candidates> tags first
  const candidatesMatch = text.match(
    /<candidates>\s*([\s\S]*?)\s*<\/candidates>/
  );
  if (candidatesMatch) {
    raw = JSON.parse(candidatesMatch[1]);
  } else {
    // Try <results> tags
    const resultsMatch = text.match(/<results>\s*([\s\S]*?)\s*<\/results>/);
    if (resultsMatch) {
      raw = JSON.parse(resultsMatch[1]);
    } else {
      // Try to find a JSON array directly
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        raw = JSON.parse(jsonMatch[0]);
      } else {
        const preview = text.slice(0, 500).replace(/\n/g, " ");
        throw new Error(`Could not parse candidates. Model returned: ${preview}`);
      }
    }
  }

  // Default status to "accepted" if model didn't include it
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
): Promise<{ candidates: Candidate[]; searchCount: number }> {
  let searchCount = 0;

  sendProgress({
    type: "progress",
    phase: "discovery",
    message: `Searching for "${procedure}" specialists...`,
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildDiscoveryMessage(procedure, geography, resultCount) },
  ];

  // Agentic loop: let Claude call web_search until it's done
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

  // Extract text from final response
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

  return { candidates, searchCount };
}

async function runVettingPhase(
  candidates: Candidate[],
  procedure: string,
  searchKey: string,
  sendProgress: (event: SSEEvent) => void
): Promise<{ vettingResults: Record<string, string>; searchCount: number }> {
  const vettingResults: Record<string, string> = {};
  let searchCount = 0;

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

  return { vettingResults, searchCount };
}

async function runScoringPhase(
  client: Anthropic,
  candidates: Candidate[],
  vettingResults: Record<string, string>,
  resultCount: number,
  sendProgress: (event: SSEEvent) => void
): Promise<Candidate[]> {
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

  return parseCandidatesFromResponse(text);
}

export async function POST(req: Request): Promise<Response> {
  let body: SearchRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    anthropicKey,
    braveSearchKey,
    procedure,
    region,
    countries,
    resultCount = 20,
  } = body;

  if (!anthropicKey || !braveSearchKey || !procedure) {
    return Response.json(
      { error: "Missing required fields: anthropicKey, braveSearchKey, procedure" },
      { status: 400 }
    );
  }

  const geography = formatGeography(region, countries);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => sendSSE(controller, event);

      try {
        const client = new Anthropic({ apiKey: anthropicKey });

        // Phase 1: Discovery
        const { candidates: rawCandidates, searchCount: discoverySearches } =
          await runDiscoveryPhase(
            client,
            procedure,
            geography,
            resultCount,
            braveSearchKey,
            send
          );

        if (rawCandidates.length === 0) {
          send({
            type: "error",
            message:
              "No candidates found. Try a different procedure name or broader geographic filter.",
          });
          send({ type: "done" });
          controller.close();
          return;
        }

        // Phase 2: Vetting
        const { vettingResults, searchCount: vettingSearches } =
          await runVettingPhase(
            rawCandidates,
            procedure,
            braveSearchKey,
            send
          );

        // Phase 3: Scoring
        const finalCandidates = await runScoringPhase(
          client,
          rawCandidates,
          vettingResults,
          resultCount,
          send
        );

        send({
          type: "result",
          data: {
            candidates: finalCandidates,
            metadata: {
              procedure,
              geography,
              totalDiscoverySearches: discoverySearches,
              totalVettingSearches: vettingSearches,
              candidatesDropped:
                rawCandidates.length - finalCandidates.length,
              timestamp: new Date().toISOString(),
            },
          },
        });

        send({ type: "done" });
      } catch (err) {
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
