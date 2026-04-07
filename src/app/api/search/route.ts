import Anthropic from "@anthropic-ai/sdk";

// Allow up to 5 minutes for the full discovery + vetting + scoring pipeline
export const maxDuration = 300;

import { webSearch, formatSearchResults } from "@/lib/web-search";
import {
  SYSTEM_PROMPT,
  WEB_SEARCH_TOOL,
  buildDiscoveryMessage,
  buildScoringMessage,
} from "@/lib/prompts";
import { formatGeography } from "@/lib/countries";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Candidate, SearchResponse, SSEEvent } from "@/lib/types";

const SEARCH_ENGINE = "brave";
const LLM_MODEL = "claude-sonnet-4-5";

interface AuditEntry {
  phase: "discovery" | "vetting" | "scoring";
  event_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function auditEntry(
  phase: AuditEntry["phase"],
  event_type: string,
  data: Record<string, unknown> = {}
): AuditEntry {
  return { phase, event_type, timestamp: new Date().toISOString(), data };
}

function sendSSE(
  controller: ReadableStreamDefaultController,
  event: SSEEvent
): void {
  const encoder = new TextEncoder();
  const data = JSON.stringify(event);
  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
}

function repairJSON(str: string): string {
  // Strip trailing commas before ] or }
  let fixed = str.replace(/,\s*([}\]])/g, "$1");
  // Fix unescaped newlines inside strings
  fixed = fixed.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, "\\n$1");
  // Strip JS-style comments
  fixed = fixed.replace(/\/\/[^\n]*/g, "");
  return fixed;
}

function parseCandidatesFromResponse(text: string): Candidate[] {
  let jsonStr: string | null = null;

  const candidatesMatch = text.match(
    /<candidates>\s*([\s\S]*?)\s*<\/candidates>/
  );
  if (candidatesMatch) {
    jsonStr = candidatesMatch[1];
  } else {
    const resultsMatch = text.match(/<results>\s*([\s\S]*?)\s*<\/results>/);
    if (resultsMatch) {
      jsonStr = resultsMatch[1];
    } else {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }
  }

  if (!jsonStr) {
    const preview = text.slice(0, 500).replace(/\n/g, " ");
    throw new Error(`Could not parse candidates. Model returned: ${preview}`);
  }

  let raw: Candidate[];
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    // Try repairing common JSON issues
    try {
      raw = JSON.parse(repairJSON(jsonStr));
    } catch (e) {
      const preview = jsonStr.slice(0, 500).replace(/\n/g, " ");
      throw new Error(`JSON parse failed after repair attempt: ${e instanceof Error ? e.message : "unknown"}. Preview: ${preview}`);
    }
  }

  return raw.map((c) => ({
    ...c,
    status: c.status || "accepted",
  }));
}

interface DiscoveryResult {
  candidates: Candidate[];
  searchCount: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  auditEntries: AuditEntry[];
}

async function runDiscoveryPhase(
  client: Anthropic,
  procedure: string,
  geography: string | null,
  resultCount: number,
  searchKey: string,
  sendProgress: (event: SSEEvent) => void
): Promise<DiscoveryResult> {
  let searchCount = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const auditEntries: AuditEntry[] = [];
  const start = Date.now();

  auditEntries.push(auditEntry("discovery", "phase_start"));

  sendProgress({
    type: "progress",
    phase: "discovery",
    message: `Searching for "${procedure}" specialists...`,
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildDiscoveryMessage(procedure, geography, resultCount) },
  ];

  let response = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [WEB_SEARCH_TOOL],
    messages,
  });

  tokensIn += response.usage.input_tokens;
  tokensOut += response.usage.output_tokens;
  auditEntries.push(auditEntry("discovery", "llm_call", {
    tokens_in: response.usage.input_tokens,
    tokens_out: response.usage.output_tokens,
  }));

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
          auditEntries.push(auditEntry("discovery", "web_search", {
            query,
            result_count: results.length,
          }));
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: formatSearchResults(results),
          });
        } catch (err) {
          auditEntries.push(auditEntry("discovery", "web_search_error", {
            query,
            error: err instanceof Error ? err.message : "unknown",
          }));
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
      model: LLM_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: [WEB_SEARCH_TOOL],
      messages,
    });

    tokensIn += response.usage.input_tokens;
    tokensOut += response.usage.output_tokens;
    auditEntries.push(auditEntry("discovery", "llm_call", {
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    }));
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const candidates = parseCandidatesFromResponse(text);

  auditEntries.push(auditEntry("discovery", "phase_end", {
    candidates_found: candidates.length,
  }));

  sendProgress({
    type: "progress",
    phase: "discovery",
    message: `Found ${candidates.length} candidates. Starting verification...`,
  });

  return { candidates, searchCount, durationMs: Date.now() - start, tokensIn, tokensOut, auditEntries };
}

interface VettingResult {
  vettingResults: Record<string, string>;
  searchCount: number;
  durationMs: number;
  auditEntries: AuditEntry[];
}

async function runVettingPhase(
  candidates: Candidate[],
  procedure: string,
  searchKey: string,
  sendProgress: (event: SSEEvent) => void
): Promise<VettingResult> {
  const vettingResults: Record<string, string> = {};
  let searchCount = 0;
  const auditEntries: AuditEntry[] = [];
  const start = Date.now();

  auditEntries.push(auditEntry("vetting", "phase_start", {
    candidates_to_vet: candidates.length,
  }));

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
      auditEntries.push(auditEntry("vetting", "web_search", {
        candidate: c.name,
        query,
        result_count: results.length,
      }));
    } catch (err) {
      vettingResults[c.name] = "Verification search failed.";
      auditEntries.push(auditEntry("vetting", "web_search_error", {
        candidate: c.name,
        query,
        error: err instanceof Error ? err.message : "unknown",
      }));
    }
  }

  auditEntries.push(auditEntry("vetting", "phase_end"));

  return { vettingResults, searchCount, durationMs: Date.now() - start, auditEntries };
}

interface ScoringResult {
  scored: Candidate[];
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  auditEntries: AuditEntry[];
}

async function runScoringPhase(
  client: Anthropic,
  candidates: Candidate[],
  vettingResults: Record<string, string>,
  resultCount: number,
  sendProgress: (event: SSEEvent) => void
): Promise<ScoringResult> {
  const auditEntries: AuditEntry[] = [];
  const start = Date.now();

  auditEntries.push(auditEntry("scoring", "phase_start", {
    candidates_to_score: candidates.length,
  }));

  sendProgress({
    type: "progress",
    phase: "scoring",
    message: "Scoring and ranking candidates...",
  });

  const response = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildScoringMessage(candidates, vettingResults, resultCount),
      },
    ],
  });

  const tokensIn = response.usage.input_tokens;
  const tokensOut = response.usage.output_tokens;
  auditEntries.push(auditEntry("scoring", "llm_call", {
    tokens_in: tokensIn,
    tokens_out: tokensOut,
  }));

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const scored = parseCandidatesFromResponse(text);

  auditEntries.push(auditEntry("scoring", "phase_end", {
    accepted: scored.filter((c) => c.status === "accepted").length,
    rejected: scored.filter((c) => c.status === "rejected").length,
  }));

  return { scored, durationMs: Date.now() - start, tokensIn, tokensOut, auditEntries };
}

interface SearchRequestBody {
  procedure: string;
  region?: string;
  countries?: string[];
  resultCount?: number;
}

export async function POST(req: Request): Promise<Response> {
  // Auth check uses the user's JWT
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

  // Service role client for all DB writes (bypasses RLS)
  const serviceClient = createServiceClient();

  // Insert the initial "running" row
  const { data: searchRow, error: insertError } = await serviceClient
    .from("searches")
    .insert({
      user_id: user.id,
      procedure,
      geography,
      requested_count: resultCount,
      status: "running",
      search_engine: SEARCH_ENGINE,
      llm_model: LLM_MODEL,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Failed to insert initial search row:", insertError);
  }

  const searchId: string | null = searchRow?.id ?? null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => sendSSE(controller, event);
      const allAuditEntries: AuditEntry[] = [];
      let totalTokensIn = 0;
      let totalTokensOut = 0;

      try {
        const client = new Anthropic({ apiKey: anthropicKey });

        // Phase 1: Discovery
        const discovery = await runDiscoveryPhase(
          client, procedure, geography, resultCount, braveSearchKey, send
        );
        allAuditEntries.push(...discovery.auditEntries);
        totalTokensIn += discovery.tokensIn;
        totalTokensOut += discovery.tokensOut;

        if (discovery.candidates.length === 0) {
          if (searchId) {
            await serviceClient
              .from("searches")
              .update({
                status: "failed",
                error_message: "No candidates found. Try a different procedure name or broader geographic filter.",
                search_count_discovery: discovery.searchCount,
                tokens_in: totalTokensIn,
                tokens_out: totalTokensOut,
                duration_total_s: (Date.now() - totalStart) / 1000,
                duration_discovery_s: discovery.durationMs / 1000,
                audit_log: allAuditEntries,
              })
              .eq("id", searchId);
          }

          send({
            type: "error",
            message: "No candidates found. Try a different procedure name or broader geographic filter.",
          });
          send({ type: "done" });
          controller.close();
          return;
        }

        // Phase 2: Vetting
        const vetting = await runVettingPhase(
          discovery.candidates, procedure, braveSearchKey, send
        );
        allAuditEntries.push(...vetting.auditEntries);

        // Phase 3: Scoring
        const scoring = await runScoringPhase(
          client, discovery.candidates, vetting.vettingResults, resultCount, send
        );
        allAuditEntries.push(...scoring.auditEntries);
        totalTokensIn += scoring.tokensIn;
        totalTokensOut += scoring.tokensOut;

        const totalMs = Date.now() - totalStart;

        const responseData: SearchResponse = {
          candidates: scoring.scored,
          metadata: {
            procedure,
            geography,
            searchCountDiscovery: discovery.searchCount,
            searchCountVetting: vetting.searchCount,
            timestamp: new Date().toISOString(),
          },
        };

        // Update the search row to completed
        if (searchId) {
          await serviceClient
            .from("searches")
            .update({
              status: "completed",
              result_count: scoring.scored.length,
              results_json: scoring.scored,
              search_count_discovery: discovery.searchCount,
              search_count_vetting: vetting.searchCount,
              tokens_in: totalTokensIn,
              tokens_out: totalTokensOut,
              duration_total_s: totalMs / 1000,
              duration_discovery_s: discovery.durationMs / 1000,
              duration_vetting_s: vetting.durationMs / 1000,
              duration_scoring_s: scoring.durationMs / 1000,
              audit_log: allAuditEntries,
            })
            .eq("id", searchId);
        }

        send({
          type: "result",
          data: responseData,
          searchId,
        });

        send({ type: "done" });
      } catch (err) {
        if (searchId) {
          await serviceClient
            .from("searches")
            .update({
              status: "failed",
              error_message: err instanceof Error ? err.message.slice(0, 500) : "unknown",
              tokens_in: totalTokensIn,
              tokens_out: totalTokensOut,
              duration_total_s: (Date.now() - totalStart) / 1000,
              audit_log: allAuditEntries,
            })
            .eq("id", searchId);
        }

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
