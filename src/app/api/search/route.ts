import Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";

export const maxDuration = 300;

import { webSearch, formatSearchResults } from "@/lib/web-search";
import {
  DISCOVERY_SYSTEM_PROMPT,
  FILTERING_SYSTEM_PROMPT,
  CROSS_BATCH_DEDUP_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  WEB_SEARCH_TOOL,
  buildDiscoveryRoundMessage,
  buildFilteringMessage,
  buildCrossBatchDedupMessage,
  buildResearchMessage,
} from "@/lib/prompts";
import { formatGeography } from "@/lib/countries";
import {
  MAX_ACCEPTED_RESULTS,
  MAX_DISCOVERY_SEARCHES,
  DISCOVERY_BATCH_SIZE,
  MAX_RESEARCH_SEARCHES_PER_CANDIDATE,
  FILTERING_BATCH_SIZE,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  Candidate,
  SearchResponse,
  SSEEvent,
  DiscoveryCandidate,
  DiscoveryRoundOutput,
  FilteredCandidate,
  ResearchedCandidate,
} from "@/lib/types";

const SEARCH_ENGINE = "brave";
const LLM_MODEL = "claude-sonnet-4-5";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

interface AuditEntry {
  phase: "discovery" | "filtering" | "research";
  event_type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function auditEntry(
  phase: AuditEntry["phase"],
  event_type: string,
  data: Record<string, unknown> = {},
): AuditEntry {
  return { phase, event_type, timestamp: new Date().toISOString(), data };
}

function sendSSE(
  controller: ReadableStreamDefaultController,
  event: SSEEvent,
): void {
  const encoder = new TextEncoder();
  const data = JSON.stringify(event);
  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
}

function repairJSON(str: string): string {
  let fixed = str.replace(/,\s*([}\]])/g, "$1");
  fixed = fixed.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, "\\n$1");
  fixed = fixed.replace(/\/\/[^\n]*/g, "");
  return fixed;
}

function parseJSON<T>(text: string, tag: string): T {
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`);
  const match = text.match(re);
  let jsonStr = match?.[1] ?? null;

  if (!jsonStr) {
    // Fallback: try to find raw JSON
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    jsonStr = jsonMatch?.[0] ?? null;
  }

  if (!jsonStr) {
    const preview = text.slice(0, 500).replace(/\n/g, " ");
    throw new Error(`Could not find <${tag}> in LLM response. Preview: ${preview}`);
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    try {
      return JSON.parse(repairJSON(jsonStr));
    } catch (e) {
      const preview = jsonStr.slice(0, 500).replace(/\n/g, " ");
      throw new Error(`JSON parse failed for <${tag}>: ${e instanceof Error ? e.message : "unknown"}. Preview: ${preview}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Discovery
// ---------------------------------------------------------------------------

interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
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
  searchKey: string,
  sendProgress: (event: SSEEvent) => void,
): Promise<DiscoveryResult> {
  let totalSearchCount = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const auditEntries: AuditEntry[] = [];
  const allCandidates: DiscoveryCandidate[] = [];
  const start = Date.now();

  auditEntries.push(auditEntry("discovery", "phase_start"));

  sendProgress({
    type: "progress",
    phase: "discovery",
    message: `Searching for "${procedure}" specialists...`,
  });

  // Run discovery in rounds
  let roundNum = 0;
  let consecutiveEmptyRounds = 0;
  while (totalSearchCount < MAX_DISCOVERY_SEARCHES) {
    roundNum++;
    let roundSearchCount = 0;

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: buildDiscoveryRoundMessage(
          procedure,
          geography,
          allCandidates,
          totalSearchCount,
          MAX_DISCOVERY_SEARCHES,
        ),
      },
    ];

    auditEntries.push(auditEntry("discovery", "round_start", { round: roundNum }));

    // Agentic tool-use loop for this round
    let response = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: 16000,
      system: DISCOVERY_SYSTEM_PROMPT,
      tools: [WEB_SEARCH_TOOL],
      messages,
    });

    tokensIn += response.usage.input_tokens;
    tokensOut += response.usage.output_tokens;

    while (response.stop_reason === "tool_use") {
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of assistantContent) {
        if (block.type === "tool_use" && block.name === "web_search") {
          const query = (block.input as { query: string }).query;
          roundSearchCount++;
          totalSearchCount++;

          sendProgress({
            type: "progress",
            phase: "discovery",
            message: `Search ${totalSearchCount}: "${query.slice(0, 80)}${query.length > 80 ? "..." : ""}"`,
          });

          try {
            const results = await webSearch(query, searchKey);
            auditEntries.push(auditEntry("discovery", "web_search", {
              round: roundNum,
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
              round: roundNum,
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

      // If we've hit the per-round cap, make a final call WITHOUT tools to force JSON output
      if (roundSearchCount >= DISCOVERY_BATCH_SIZE) {
        response = await client.messages.create({
          model: LLM_MODEL,
          max_tokens: 16000,
          system: DISCOVERY_SYSTEM_PROMPT,
          messages,
        });
      } else {
        response = await client.messages.create({
          model: LLM_MODEL,
          max_tokens: 16000,
          system: DISCOVERY_SYSTEM_PROMPT,
          tools: [WEB_SEARCH_TOOL],
          messages,
        });
      }

      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;
    }

    // Parse the round's output
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    let roundOutput: DiscoveryRoundOutput;
    try {
      roundOutput = parseJSON<DiscoveryRoundOutput>(text, "candidates");
    } catch {
      // Parse failure in a single round shouldn't kill discovery — try the next round
      auditEntries.push(auditEntry("discovery", "parse_error", {
        round: roundNum,
        text_preview: text.slice(0, 300),
      }));
      consecutiveEmptyRounds++;
      if (consecutiveEmptyRounds >= 2) break;
      continue;
    }

    const newCandidates = roundOutput.candidates ?? [];
    allCandidates.push(...newCandidates);

    auditEntries.push(auditEntry("discovery", "round_end", {
      round: roundNum,
      new_candidates: newCandidates.length,
      total_candidates: allCandidates.length,
      searches_this_round: roundSearchCount,
      exhausted: roundOutput.exhausted,
    }));

    // Stream current name list to frontend
    sendProgress({
      type: "progress",
      phase: "discovery",
      message: `Round ${roundNum} complete — ${allCandidates.length} candidates found so far`,
    });

    if (allCandidates.length > 0) {
      sendProgress({
        type: "candidates_discovered",
        names: allCandidates.map((c) => c.name),
      });
    }

    // Track consecutive empty rounds — a single dry round shouldn't kill discovery
    if (newCandidates.length === 0) {
      consecutiveEmptyRounds++;
    } else {
      consecutiveEmptyRounds = 0;
    }

    // Stop conditions
    if (roundOutput.exhausted && allCandidates.length > 0) break;
    if (consecutiveEmptyRounds >= 2) break;
    if (totalSearchCount >= MAX_DISCOVERY_SEARCHES) break;
  }

  auditEntries.push(auditEntry("discovery", "phase_end", {
    total_candidates: allCandidates.length,
    total_searches: totalSearchCount,
    rounds: roundNum,
  }));

  return {
    candidates: allCandidates,
    searchCount: totalSearchCount,
    durationMs: Date.now() - start,
    tokensIn,
    tokensOut,
    auditEntries,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: Filtering
// ---------------------------------------------------------------------------

interface FilteringResult {
  surviving: FilteredCandidate[];
  rejected: Array<{ name: string; rejectionReason: string }>;
  searchCount: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  auditEntries: AuditEntry[];
}

async function runFilteringPhase(
  client: Anthropic,
  candidates: DiscoveryCandidate[],
  procedure: string,
  searchKey: string,
  sendProgress: (event: SSEEvent) => void,
): Promise<FilteringResult> {
  let searchCount = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const auditEntries: AuditEntry[] = [];
  const start = Date.now();

  auditEntries.push(auditEntry("filtering", "phase_start", {
    candidates_to_filter: candidates.length,
  }));

  // Step 1: Direct web search per candidate
  const searchResults: Record<string, string> = {};

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const query = `"${c.name}" ${procedure}`;

    sendProgress({
      type: "progress",
      phase: "filtering",
      message: `Searching ${c.name}...`,
      current: i + 1,
      total: candidates.length,
    });

    try {
      const results = await webSearch(query, searchKey);
      searchCount++;
      searchResults[c.name] = formatSearchResults(results);
      auditEntries.push(auditEntry("filtering", "web_search", {
        candidate: c.name,
        query,
        result_count: results.length,
      }));
    } catch (err) {
      searchResults[c.name] = "Search failed.";
      auditEntries.push(auditEntry("filtering", "web_search_error", {
        candidate: c.name,
        query,
        error: err instanceof Error ? err.message : "unknown",
      }));
    }
  }

  // Step 2: Batched LLM evaluation
  const allSurviving: FilteredCandidate[] = [];
  const allRejected: Array<{ name: string; rejectionReason: string }> = [];

  for (let i = 0; i < candidates.length; i += FILTERING_BATCH_SIZE) {
    const batch = candidates.slice(i, i + FILTERING_BATCH_SIZE);
    const batchResults: Record<string, string> = {};
    for (const c of batch) {
      batchResults[c.name] = searchResults[c.name] ?? "No search results.";
    }

    sendProgress({
      type: "progress",
      phase: "filtering",
      message: `Evaluating batch ${Math.floor(i / FILTERING_BATCH_SIZE) + 1}...`,
    });

    try {
      const response = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 16000,
        system: FILTERING_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildFilteringMessage(batch, batchResults, procedure),
          },
        ],
      });

      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const parsed = parseJSON<{
        surviving: FilteredCandidate[];
        rejected: Array<{ name: string; rejectionReason: string }>;
      }>(text, "filtered");

      allSurviving.push(...(parsed.surviving ?? []));
      allRejected.push(...(parsed.rejected ?? []));

      auditEntries.push(auditEntry("filtering", "batch_eval", {
        batch_start: i,
        batch_size: batch.length,
        surviving: parsed.surviving?.length ?? 0,
        rejected: parsed.rejected?.length ?? 0,
      }));
    } catch (err) {
      // On batch failure, keep all candidates in batch as surviving
      auditEntries.push(auditEntry("filtering", "batch_eval_error", {
        batch_start: i,
        error: err instanceof Error ? err.message : "unknown",
      }));
      allSurviving.push(...batch);
    }
  }

  // Step 3: Cross-batch dedup (only if we had multiple batches)
  let finalSurviving = allSurviving;
  let finalRejected = allRejected;

  if (candidates.length > FILTERING_BATCH_SIZE && allSurviving.length > 0) {
    sendProgress({
      type: "progress",
      phase: "filtering",
      message: "Cross-batch deduplication...",
    });

    try {
      const response = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 16000,
        system: CROSS_BATCH_DEDUP_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: buildCrossBatchDedupMessage(allSurviving) },
        ],
      });

      tokensIn += response.usage.input_tokens;
      tokensOut += response.usage.output_tokens;

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const parsed = parseJSON<{
        surviving: FilteredCandidate[];
        rejected: Array<{ name: string; rejectionReason: string }>;
      }>(text, "deduped");

      finalSurviving = parsed.surviving ?? allSurviving;
      finalRejected = [...allRejected, ...(parsed.rejected ?? [])];

      auditEntries.push(auditEntry("filtering", "cross_batch_dedup", {
        before: allSurviving.length,
        after: finalSurviving.length,
        new_rejects: parsed.rejected?.length ?? 0,
      }));
    } catch (err) {
      auditEntries.push(auditEntry("filtering", "cross_batch_dedup_error", {
        error: err instanceof Error ? err.message : "unknown",
      }));
      // Keep allSurviving as-is on failure
    }
  }

  auditEntries.push(auditEntry("filtering", "phase_end", {
    surviving: finalSurviving.length,
    rejected: finalRejected.length,
  }));

  // Stream the filtered name list
  sendProgress({
    type: "candidates_filtered",
    names: finalSurviving.map((c) => c.name),
  });

  sendProgress({
    type: "progress",
    phase: "filtering",
    message: `Filtering complete — ${finalSurviving.length} candidates surviving, ${finalRejected.length} rejected`,
  });

  return {
    surviving: finalSurviving,
    rejected: finalRejected,
    searchCount,
    durationMs: Date.now() - start,
    tokensIn,
    tokensOut,
    auditEntries,
  };
}

// ---------------------------------------------------------------------------
// Phase 3: Research
// ---------------------------------------------------------------------------

interface ResearchResult {
  researched: ResearchedCandidate[];
  searchCount: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  failureCount: number;
  auditEntries: AuditEntry[];
}

async function runResearchAgent(
  client: Anthropic,
  procedure: string,
  candidate: FilteredCandidate,
  searchKey: string,
  maxSearches: number,
): Promise<{ result: ResearchedCandidate; searchCount: number; tokensIn: number; tokensOut: number }> {
  let searchCount = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildResearchMessage(procedure, candidate.name, candidate.notes) },
  ];

  let response = await client.messages.create({
    model: LLM_MODEL,
    max_tokens: 8000,
    system: RESEARCH_SYSTEM_PROMPT,
    tools: [WEB_SEARCH_TOOL],
    messages,
  });

  tokensIn += response.usage.input_tokens;
  tokensOut += response.usage.output_tokens;

  while (response.stop_reason === "tool_use") {
    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of assistantContent) {
      if (block.type === "tool_use" && block.name === "web_search") {
        const query = (block.input as { query: string }).query;
        searchCount++;

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

    // If we've hit the per-candidate search cap, force text output
    if (searchCount >= maxSearches) {
      response = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 8000,
        system: RESEARCH_SYSTEM_PROMPT,
        messages,
      });
    } else {
      response = await client.messages.create({
        model: LLM_MODEL,
        max_tokens: 8000,
        system: RESEARCH_SYSTEM_PROMPT,
        tools: [WEB_SEARCH_TOOL],
        messages,
      });
    }

    tokensIn += response.usage.input_tokens;
    tokensOut += response.usage.output_tokens;
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const result = parseJSON<ResearchedCandidate>(text, "research");

  return { result, searchCount, tokensIn, tokensOut };
}

function makeDegradedResearchResult(candidate: FilteredCandidate): ResearchedCandidate {
  return {
    name: candidate.name,
    summary: "Research unavailable — insufficient data to evaluate.",
    evidence: "",
    score: 0,
    institution: "Unknown",
    city: "Unknown",
    specialty: "Unknown",
    source: "Unknown",
    profileLink: null,
    disqualified: false,
  };
}

async function runResearchPhase(
  client: Anthropic,
  candidates: FilteredCandidate[],
  procedure: string,
  searchKey: string,
  sendProgress: (event: SSEEvent) => void,
): Promise<ResearchResult> {
  const auditEntries: AuditEntry[] = [];
  const start = Date.now();
  let totalSearchCount = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let completedCount = 0;
  let failureCount = 0;

  auditEntries.push(auditEntry("research", "phase_start", {
    candidates_to_research: candidates.length,
  }));

  sendProgress({
    type: "progress",
    phase: "research",
    message: `Researching ${candidates.length} candidates...`,
    current: 0,
    total: candidates.length,
  });

  const limit = pLimit(10);

  const promises = candidates.map((candidate) =>
    limit(async () => {
      try {
        const agentResult = await runResearchAgent(
          client,
          procedure,
          candidate,
          searchKey,
          MAX_RESEARCH_SEARCHES_PER_CANDIDATE,
        );

        totalSearchCount += agentResult.searchCount;
        totalTokensIn += agentResult.tokensIn;
        totalTokensOut += agentResult.tokensOut;
        completedCount++;

        auditEntries.push(auditEntry("research", "agent_complete", {
          candidate: candidate.name,
          score: agentResult.result.score,
          searches: agentResult.searchCount,
          disqualified: agentResult.result.disqualified,
        }));

        sendProgress({
          type: "progress",
          phase: "research",
          message: `Researched ${candidate.name} (score: ${agentResult.result.score})`,
          current: completedCount + failureCount,
          total: candidates.length,
        });

        return agentResult.result;
      } catch (err) {
        failureCount++;

        auditEntries.push(auditEntry("research", "agent_error", {
          candidate: candidate.name,
          error: err instanceof Error ? err.message : "unknown",
        }));

        sendProgress({
          type: "progress",
          phase: "research",
          message: `Research failed for ${candidate.name}`,
          current: completedCount + failureCount,
          total: candidates.length,
        });

        return makeDegradedResearchResult(candidate);
      }
    }),
  );

  const results = await Promise.all(promises);

  // Warn if >20% failure rate
  if (failureCount > 0 && failureCount / candidates.length > 0.2) {
    sendProgress({
      type: "progress",
      phase: "research",
      message: `Warning: ${failureCount} of ${candidates.length} research agents failed (${Math.round(failureCount / candidates.length * 100)}%)`,
    });
  }

  auditEntries.push(auditEntry("research", "phase_end", {
    total_researched: results.length,
    failures: failureCount,
    total_searches: totalSearchCount,
  }));

  return {
    researched: results,
    searchCount: totalSearchCount,
    durationMs: Date.now() - start,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    failureCount,
    auditEntries,
  };
}

// ---------------------------------------------------------------------------
// Phase 4: Score (mechanical — no LLM)
// ---------------------------------------------------------------------------

function runScorePhase(
  researched: ResearchedCandidate[],
  filteringRejected: Array<{ name: string; rejectionReason: string }>,
): Candidate[] {
  const allCandidates: Candidate[] = [];

  // Process researched candidates
  for (const r of researched) {
    if (r.disqualified) {
      allCandidates.push({
        rank: 0,
        name: r.name,
        summary: r.summary,
        institution: r.institution,
        city: r.city,
        specialty: r.specialty,
        evidence: r.evidence,
        source: r.source,
        profileLink: r.profileLink,
        score: r.score,
        status: "rejected",
        rejectionReason: r.disqualificationReason ?? "Disqualified during research",
        rejectionStage: "research",
      });
    } else if (r.score === 0 && r.summary.startsWith("Research unavailable")) {
      allCandidates.push({
        rank: 0,
        name: r.name,
        summary: r.summary,
        institution: r.institution,
        city: r.city,
        specialty: r.specialty,
        evidence: r.evidence,
        source: r.source,
        profileLink: r.profileLink,
        score: r.score,
        status: "rejected",
        rejectionReason: "Research incomplete — insufficient data to evaluate",
        rejectionStage: "research",
      });
    } else {
      allCandidates.push({
        rank: 0, // assigned below
        name: r.name,
        summary: r.summary,
        institution: r.institution,
        city: r.city,
        specialty: r.specialty,
        evidence: r.evidence,
        source: r.source,
        profileLink: r.profileLink,
        score: r.score,
        status: "accepted", // may be changed to rejected below
      });
    }
  }

  // Add filtering-rejected candidates
  for (const r of filteringRejected) {
    allCandidates.push({
      rank: 0,
      name: r.name,
      summary: "",
      institution: "Unknown",
      city: "Unknown",
      specialty: "Unknown",
      evidence: "",
      source: "",
      profileLink: null,
      score: 0,
      status: "rejected",
      rejectionReason: r.rejectionReason,
      rejectionStage: "filtering",
    });
  }

  // Sort non-rejected by score descending, assign ranks, apply acceptance cutoff
  const rankable = allCandidates.filter(
    (c) => c.status === "accepted",
  );
  rankable.sort((a, b) => b.score - a.score);

  rankable.forEach((c, i) => {
    c.rank = i + 1;
    if (i >= MAX_ACCEPTED_RESULTS) {
      c.status = "rejected";
      c.rejectionReason = "Below acceptance threshold";
      c.rejectionStage = "score";
    }
  });

  // Rejected candidates get rank 0 (unranked)
  return allCandidates;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

interface SearchRequestBody {
  procedure: string;
  region?: string;
  countries?: string[];
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
      { status: 500 },
    );
  }

  let body: SearchRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { procedure, region, countries } = body;

  if (!procedure) {
    return Response.json(
      { error: "Missing required field: procedure" },
      { status: 400 },
    );
  }

  const geography = formatGeography(region, countries);
  const totalStart = Date.now();

  const serviceClient = createServiceClient();

  const { data: searchRow, error: insertError } = await serviceClient
    .from("searches")
    .insert({
      user_id: user.id,
      procedure,
      geography,
      requested_count: MAX_ACCEPTED_RESULTS,
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
        const anthropic = new Anthropic({ apiKey: anthropicKey });

        // Phase 1: Discovery
        const discovery = await runDiscoveryPhase(
          anthropic, procedure, geography, braveSearchKey, send,
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

        // Phase 2: Filtering
        const filtering = await runFilteringPhase(
          anthropic, discovery.candidates, procedure, braveSearchKey, send,
        );
        allAuditEntries.push(...filtering.auditEntries);
        totalTokensIn += filtering.tokensIn;
        totalTokensOut += filtering.tokensOut;

        if (filtering.surviving.length === 0) {
          // All candidates filtered out — still produce results with all rejected
          const scoredCandidates = runScorePhase([], filtering.rejected);
          const totalMs = Date.now() - totalStart;

          const responseData: SearchResponse = {
            candidates: scoredCandidates,
            metadata: {
              procedure,
              geography,
              searchCountDiscovery: discovery.searchCount,
              searchCountFiltering: filtering.searchCount,
              searchCountResearch: 0,
              timestamp: new Date().toISOString(),
            },
          };

          if (searchId) {
            await serviceClient
              .from("searches")
              .update({
                status: "completed",
                result_count: scoredCandidates.length,
                results_json: scoredCandidates,
                search_count_discovery: discovery.searchCount,
                search_count_filtering: filtering.searchCount,
                search_count_research: 0,
                tokens_in: totalTokensIn,
                tokens_out: totalTokensOut,
                duration_total_s: totalMs / 1000,
                duration_discovery_s: discovery.durationMs / 1000,
                duration_filtering_s: filtering.durationMs / 1000,
                duration_research_s: 0,
                audit_log: allAuditEntries,
              })
              .eq("id", searchId);
          }

          send({ type: "result", data: responseData, searchId });
          send({ type: "done" });
          controller.close();
          return;
        }

        // Phase 3: Research
        const research = await runResearchPhase(
          anthropic, filtering.surviving, procedure, braveSearchKey, send,
        );
        allAuditEntries.push(...research.auditEntries);
        totalTokensIn += research.tokensIn;
        totalTokensOut += research.tokensOut;

        // Phase 4: Score
        const scoredCandidates = runScorePhase(
          research.researched,
          filtering.rejected,
        );

        const totalMs = Date.now() - totalStart;

        const responseData: SearchResponse = {
          candidates: scoredCandidates,
          metadata: {
            procedure,
            geography,
            searchCountDiscovery: discovery.searchCount,
            searchCountFiltering: filtering.searchCount,
            searchCountResearch: research.searchCount,
            timestamp: new Date().toISOString(),
          },
        };

        if (searchId) {
          await serviceClient
            .from("searches")
            .update({
              status: "completed",
              result_count: scoredCandidates.length,
              results_json: scoredCandidates,
              search_count_discovery: discovery.searchCount,
              search_count_filtering: filtering.searchCount,
              search_count_research: research.searchCount,
              tokens_in: totalTokensIn,
              tokens_out: totalTokensOut,
              duration_total_s: totalMs / 1000,
              duration_discovery_s: discovery.durationMs / 1000,
              duration_filtering_s: filtering.durationMs / 1000,
              duration_research_s: research.durationMs / 1000,
              audit_log: allAuditEntries,
            })
            .eq("id", searchId);
        }

        send({ type: "result", data: responseData, searchId });
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
