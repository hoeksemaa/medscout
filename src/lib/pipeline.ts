import Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";

import { webSearch, formatSearchResults } from "@/lib/web-search";
import {
  DISCOVERY_SYSTEM_PROMPT,
  FILTERING_SYSTEM_PROMPT,
  RESEARCH_SYSTEM_PROMPT,
  WEB_SEARCH_TOOL,
  buildDiscoveryRoundMessage,
  buildResearchMessage,
} from "@/lib/prompts";
import {
  MAX_ACCEPTED_RESULTS,
  MAX_DISCOVERY_SEARCHES_PER_CHUNK,
  MAX_RESEARCH_SEARCHES_PER_CANDIDATE,
} from "@/lib/constants";
import type {
  Candidate,
  SSEEvent,
  AuditEntry,
  DiscoveryCandidate,
  FilteredCandidate,
  FilterRejection,
  ResearchedCandidate,
} from "@/lib/types";

export const LLM_MODEL = "claude-sonnet-4-5";

export function auditEntry(
  phase: AuditEntry["phase"],
  event_type: string,
  data: Record<string, unknown> = {},
): AuditEntry {
  return { phase, event_type, timestamp: new Date().toISOString(), data };
}

export function sendSSE(
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

export function parseJSON<T>(text: string, tag: string): T {
  const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`);
  const match = text.match(re);
  let jsonStr = match?.[1] ?? null;

  if (!jsonStr) {
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
// Phase 1: Discovery (one chunk — up to MAX_DISCOVERY_SEARCHES_PER_CHUNK)
// ---------------------------------------------------------------------------

export interface DiscoveryChunkResult {
  candidates: DiscoveryCandidate[];
  searchCount: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  auditEntries: AuditEntry[];
}

export async function runDiscoveryChunk(
  client: Anthropic,
  procedure: string,
  geography: string | null,
  searchKey: string,
  accumulatedCandidates: DiscoveryCandidate[],
  totalSearchesSoFar: number,
  sendProgress: (event: SSEEvent) => void,
): Promise<DiscoveryChunkResult> {
  let searchCount = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const auditEntries: AuditEntry[] = [];
  const start = Date.now();

  auditEntries.push(auditEntry("discovery", "chunk_start", {
    accumulated_candidates: accumulatedCandidates.length,
    total_searches_so_far: totalSearchesSoFar,
  }));

  sendProgress({
    type: "progress",
    phase: "discovery",
    message: `Discovery round — ${accumulatedCandidates.length} candidates found so far, searching...`,
  });

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildDiscoveryRoundMessage(
        procedure,
        geography,
        accumulatedCandidates,
        totalSearchesSoFar,
      ),
    },
  ];

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
        searchCount++;

        const globalSearchNum = totalSearchesSoFar + searchCount;
        sendProgress({
          type: "progress",
          phase: "discovery",
          message: `Search ${globalSearchNum}: "${query.slice(0, 80)}${query.length > 80 ? "..." : ""}"`,
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

    // Strip tools at the per-chunk cap to force candidate JSON output.
    // The flexible parser handles whatever format the LLM produces.
    if (searchCount >= MAX_DISCOVERY_SEARCHES_PER_CHUNK) {
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

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  let newCandidates: DiscoveryCandidate[] = [];

  // Flexible parse — try multiple formats (array, object, multiple tags, raw JSON)
  const parseCandidates = (text: string): DiscoveryCandidate[] => {
    // Try <candidates> tag first
    for (const tag of ["candidates", "results"]) {
      const re = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`);
      const match = text.match(re);
      if (match) {
        const inner = match[1];
        try {
          const parsed = JSON.parse(inner);
          // Could be an array directly, or an object with a candidates field
          if (Array.isArray(parsed)) return parsed;
          if (parsed?.candidates && Array.isArray(parsed.candidates)) return parsed.candidates;
        } catch {
          try {
            const parsed = JSON.parse(repairJSON(inner));
            if (Array.isArray(parsed)) return parsed;
            if (parsed?.candidates && Array.isArray(parsed.candidates)) return parsed.candidates;
          } catch { /* try next pattern */ }
        }
      }
    }

    // Fallback: raw JSON array anywhere in text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        try {
          const parsed = JSON.parse(repairJSON(arrayMatch[0]));
          if (Array.isArray(parsed)) return parsed;
        } catch { /* give up */ }
      }
    }

    return [];
  };

  newCandidates = parseCandidates(text);

  if (newCandidates.length === 0 && searchCount > 0) {
    auditEntries.push(auditEntry("discovery", "parse_warning", {
      text_preview: text.slice(0, 500),
      message: "LLM searched but no candidates could be parsed from output",
    }));
  }

  auditEntries.push(auditEntry("discovery", "chunk_end", {
    new_candidates: newCandidates.length,
    searches_this_chunk: searchCount,
  }));

  const allCandidates = [...accumulatedCandidates, ...newCandidates];

  sendProgress({
    type: "progress",
    phase: "discovery",
    message: `Discovery chunk complete — ${allCandidates.length} candidates found (${newCandidates.length} new)`,
  });

  if (allCandidates.length > 0) {
    sendProgress({
      type: "candidates_discovered",
      names: allCandidates.map((c) => c.name),
    });
  }

  return {
    candidates: allCandidates,
    searchCount,
    durationMs: Date.now() - start,
    tokensIn,
    tokensOut,
    auditEntries,
  };
}

// ---------------------------------------------------------------------------
// Phase 2: Filtering
// ---------------------------------------------------------------------------

export interface FilteringResult {
  surviving: FilteredCandidate[];
  rejected: FilterRejection[];
  searchCount: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  auditEntries: AuditEntry[];
}

export async function runFilteringPhase(
  client: Anthropic,
  candidates: DiscoveryCandidate[],
  procedure: string,
  searchKey: string,
  sendProgress: (event: SSEEvent) => void,
): Promise<FilteringResult> {
  let tokensIn = 0;
  let tokensOut = 0;
  const auditEntries: AuditEntry[] = [];
  const start = Date.now();

  auditEntries.push(auditEntry("filtering", "phase_start", {
    candidates_to_filter: candidates.length,
  }));

  sendProgress({
    type: "progress",
    phase: "filtering",
    message: `Filtering ${candidates.length} candidates — deduplicating and normalizing names...`,
  });

  // Single LLM call — no per-candidate searches, no batching.
  // Filtering works from discovery notes alone. Deceased/retired detection
  // is deferred to the research phase (10 searches per candidate).
  let finalSurviving: FilteredCandidate[] = [];
  let finalRejected: FilterRejection[] = [];

  try {
    const candidateList = candidates
      .map((c) => `- ${c.name}: ${c.notes}`)
      .join("\n");

    const response = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: 16000,
      system: FILTERING_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Review these candidates for: "${procedure}"\n\n## Candidates\n${candidateList}\n\nDeduplicate, disqualify obvious non-candidates, and normalize names per your instructions. Return ALL candidates — surviving and rejected.`,
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
      rejected: FilterRejection[];
    }>(text, "filtered");

    finalSurviving = parsed.surviving ?? [];
    finalRejected = parsed.rejected ?? [];

    auditEntries.push(auditEntry("filtering", "eval_complete", {
      surviving: finalSurviving.length,
      rejected: finalRejected.length,
    }));
  } catch (err) {
    // On failure, keep all candidates as surviving — research will evaluate
    auditEntries.push(auditEntry("filtering", "eval_error", {
      error: err instanceof Error ? err.message : "unknown",
    }));
    finalSurviving = candidates;
  }

  auditEntries.push(auditEntry("filtering", "phase_end", {
    surviving: finalSurviving.length,
    rejected: finalRejected.length,
  }));

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
    searchCount: 0,
    durationMs: Date.now() - start,
    tokensIn,
    tokensOut,
    auditEntries,
  };
}

// ---------------------------------------------------------------------------
// Phase 3: Research (one chunk of candidates)
// ---------------------------------------------------------------------------

export interface ResearchChunkResult {
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

export async function runResearchChunk(
  client: Anthropic,
  candidates: FilteredCandidate[],
  procedure: string,
  searchKey: string,
  totalCandidates: number,
  completedSoFar: number,
  sendProgress: (event: SSEEvent) => void,
): Promise<ResearchChunkResult> {
  const auditEntries: AuditEntry[] = [];
  const start = Date.now();
  let totalSearchCount = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let completedCount = 0;
  let failureCount = 0;

  auditEntries.push(auditEntry("research", "chunk_start", {
    candidates_in_chunk: candidates.length,
    completed_so_far: completedSoFar,
  }));

  sendProgress({
    type: "progress",
    phase: "research",
    message: `Researching candidates ${completedSoFar + 1}–${completedSoFar + candidates.length} of ${totalCandidates}...`,
    current: completedSoFar,
    total: totalCandidates,
  });

  const limit = pLimit(1);
  let isFirstAgent = true;

  const promises = candidates.map((candidate) =>
    limit(async () => {
      // 3s pause between agents to avoid rate limits
      if (!isFirstAgent) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      isFirstAgent = false;

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
          current: completedSoFar + completedCount + failureCount,
          total: totalCandidates,
        });

        return agentResult.result;
      } catch (err) {
        failureCount++;

        const reason = err instanceof Error ? err.message : "unknown";
        const shortReason = reason.length > 120 ? reason.slice(0, 120) + "…" : reason;

        auditEntries.push(auditEntry("research", "agent_error", {
          candidate: candidate.name,
          error: reason,
        }));

        sendProgress({
          type: "progress",
          phase: "research",
          message: `Research failed for ${candidate.name}: ${shortReason}`,
          current: completedSoFar + completedCount + failureCount,
          total: totalCandidates,
        });

        return makeDegradedResearchResult(candidate);
      }
    }),
  );

  const results = await Promise.all(promises);

  auditEntries.push(auditEntry("research", "chunk_end", {
    researched: results.length,
    failures: failureCount,
    searches: totalSearchCount,
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

export function runScorePhase(
  researched: ResearchedCandidate[],
  filteringRejected: FilterRejection[],
): Candidate[] {
  const allCandidates: Candidate[] = [];

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
        status: "accepted",
      });
    }
  }

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

  const rankable = allCandidates.filter((c) => c.status === "accepted");
  rankable.sort((a, b) => b.score - a.score);

  rankable.forEach((c, i) => {
    c.rank = i + 1;
    if (i >= MAX_ACCEPTED_RESULTS) {
      c.status = "rejected";
      c.rejectionReason = "Below acceptance threshold";
      c.rejectionStage = "score";
    }
  });

  // Sort: accepted by rank ascending, then rejected
  allCandidates.sort((a, b) => {
    if (a.status === "accepted" && b.status === "accepted") return a.rank - b.rank;
    if (a.status === "accepted") return -1;
    if (b.status === "accepted") return 1;
    return 0;
  });

  return allCandidates;
}
