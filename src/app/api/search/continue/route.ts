import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 200;

import {
  MAX_DISCOVERY_TOTAL_SEARCHES,
  RESEARCH_CANDIDATES_PER_CHUNK,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  runDiscoveryChunk,
  runFilteringPhase,
  runResearchChunk,
  runScorePhase,
  sendSSE,
  LLM_MODEL,
} from "@/lib/pipeline";
import type {
  SSEEvent,
  PipelineState,
  SearchResponse,
  ResearchedCandidate,
} from "@/lib/types";

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const braveSearchKey = process.env.BRAVE_SEARCH_API_KEY;

  if (!anthropicKey || !braveSearchKey) {
    return Response.json({ error: "Server API keys not configured" }, { status: 500 });
  }

  let body: { searchId: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { searchId } = body;
  if (!searchId) {
    return Response.json({ error: "Missing searchId" }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  // Load current state
  const { data: search, error: loadError } = await serviceClient
    .from("searches")
    .select("id, user_id, procedure, geography, pipeline_state, started_at")
    .eq("id", searchId)
    .single();

  if (loadError || !search) {
    return Response.json({ error: "Search not found" }, { status: 404 });
  }

  if (search.user_id !== user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const state = search.pipeline_state as PipelineState;
  if (!state || state.step.phase === "done") {
    return Response.json({ error: "Pipeline already complete" }, { status: 400 });
  }

  const procedure = search.procedure;
  const geography = search.geography;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => sendSSE(controller, event);

      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey });
        let nextState: PipelineState = { ...state };

        // ---------- DISCOVERY CHUNK ----------
        if (state.step.phase === "discovery") {
          const { candidates, searchCount: prevSearchCount, round } = state.step;

          const chunk = await runDiscoveryChunk(
            anthropic, procedure, geography, braveSearchKey,
            candidates, prevSearchCount, send,
          );

          const newTotalSearches = prevSearchCount + chunk.searchCount;
          const moreDiscovery = newTotalSearches < MAX_DISCOVERY_TOTAL_SEARCHES && chunk.candidates.length > candidates.length;

          nextState = {
            ...state,
            step: moreDiscovery
              ? { phase: "discovery", round: round + 1, candidates: chunk.candidates, searchCount: newTotalSearches }
              : { phase: "filtering", candidates: chunk.candidates },
            tokensIn: state.tokensIn + chunk.tokensIn,
            tokensOut: state.tokensOut + chunk.tokensOut,
            auditEntries: [...state.auditEntries, ...chunk.auditEntries],
            timings: { ...state.timings, discoveryMs: (state.timings.discoveryMs ?? 0) + chunk.durationMs },
            searchCounts: { ...state.searchCounts, discovery: newTotalSearches },
          };
        }

        // ---------- FILTERING ----------
        else if (state.step.phase === "filtering") {
          const filtering = await runFilteringPhase(
            anthropic, state.step.candidates, procedure, braveSearchKey, send,
          );

          const surviving = filtering.surviving;
          const researchBatches = Math.ceil(surviving.length / RESEARCH_CANDIDATES_PER_CHUNK);

          nextState = {
            ...state,
            step: surviving.length > 0
              ? { phase: "research", batch: 0, surviving, rejected: filtering.rejected, researched: [] }
              : { phase: "score", surviving: [], rejected: filtering.rejected, researched: [] },
            tokensIn: state.tokensIn + filtering.tokensIn,
            tokensOut: state.tokensOut + filtering.tokensOut,
            auditEntries: [...state.auditEntries, ...filtering.auditEntries],
            timings: { ...state.timings, filteringMs: filtering.durationMs },
            searchCounts: { ...state.searchCounts, filtering: filtering.searchCount },
          };
        }

        // ---------- RESEARCH CHUNK ----------
        else if (state.step.phase === "research") {
          const { batch, surviving, rejected, researched } = state.step;
          const startIdx = batch * RESEARCH_CANDIDATES_PER_CHUNK;
          const batchCandidates = surviving.slice(startIdx, startIdx + RESEARCH_CANDIDATES_PER_CHUNK);

          const chunk = await runResearchChunk(
            anthropic, batchCandidates, procedure, braveSearchKey,
            surviving.length, researched.length, send,
          );

          const allResearched = [...researched, ...chunk.researched];
          const nextBatch = batch + 1;
          const moreBatches = nextBatch * RESEARCH_CANDIDATES_PER_CHUNK < surviving.length;

          nextState = {
            ...state,
            step: moreBatches
              ? { phase: "research", batch: nextBatch, surviving, rejected, researched: allResearched }
              : { phase: "score", surviving, rejected, researched: allResearched },
            tokensIn: state.tokensIn + chunk.tokensIn,
            tokensOut: state.tokensOut + chunk.tokensOut,
            auditEntries: [...state.auditEntries, ...chunk.auditEntries],
            timings: { ...state.timings, researchMs: (state.timings.researchMs ?? 0) + chunk.durationMs },
            searchCounts: { ...state.searchCounts, research: (state.searchCounts.research ?? 0) + chunk.searchCount },
          };
        }

        // ---------- SCORE ----------
        else if (state.step.phase === "score") {
          const scoredCandidates = runScorePhase(
            state.step.researched,
            state.step.rejected,
          );

          const totalMs = Date.now() - new Date(search.started_at).getTime();

          const responseData: SearchResponse = {
            candidates: scoredCandidates,
            metadata: {
              procedure,
              geography,
              searchCountDiscovery: nextState.searchCounts.discovery ?? 0,
              searchCountFiltering: nextState.searchCounts.filtering ?? 0,
              searchCountResearch: nextState.searchCounts.research ?? 0,
              timestamp: new Date().toISOString(),
            },
          };

          nextState = {
            ...state,
            step: { phase: "done" },
          };

          await serviceClient
            .from("searches")
            .update({
              status: "completed",
              result_count: scoredCandidates.length,
              results_json: scoredCandidates,
              search_count_discovery: state.searchCounts.discovery ?? 0,
              search_count_filtering: state.searchCounts.filtering ?? 0,
              search_count_research: state.searchCounts.research ?? 0,
              tokens_in: state.tokensIn,
              tokens_out: state.tokensOut,
              duration_total_s: totalMs / 1000,
              duration_discovery_s: (state.timings.discoveryMs ?? 0) / 1000,
              duration_filtering_s: (state.timings.filteringMs ?? 0) / 1000,
              duration_research_s: (state.timings.researchMs ?? 0) / 1000,
              audit_log: state.auditEntries,
              pipeline_state: nextState,
            })
            .eq("id", searchId);

          send({ type: "result", data: responseData, searchId });
          send({ type: "done" });
          controller.close();
          return;
        }

        // Save state and signal chunk done (for non-terminal phases)
        await serviceClient
          .from("searches")
          .update({
            pipeline_state: nextState,
            tokens_in: nextState.tokensIn,
            tokens_out: nextState.tokensOut,
            audit_log: nextState.auditEntries,
          })
          .eq("id", searchId);

        send({ type: "chunk_done", searchId });
      } catch (err) {
        await serviceClient
          .from("searches")
          .update({
            status: "failed",
            error_message: err instanceof Error ? err.message.slice(0, 500) : "unknown",
            tokens_in: state.tokensIn,
            tokens_out: state.tokensOut,
            audit_log: state.auditEntries,
          })
          .eq("id", searchId);

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
