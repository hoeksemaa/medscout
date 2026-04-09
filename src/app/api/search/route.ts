import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 275;

import { formatGeography } from "@/lib/countries";
import { MAX_ACCEPTED_RESULTS, MAX_DISCOVERY_TOTAL_SEARCHES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runDiscoveryChunk, sendSSE, LLM_MODEL } from "@/lib/pipeline";
import type { SSEEvent, PipelineState } from "@/lib/types";

const SEARCH_ENGINE = "brave";

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
    return Response.json({ error: "Server API keys not configured" }, { status: 500 });
  }

  let body: SearchRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { procedure, region, countries } = body;

  if (!procedure) {
    return Response.json({ error: "Missing required field: procedure" }, { status: 400 });
  }

  const geography = formatGeography(region, countries);
  const serviceClient = createServiceClient();

  // Initialize pipeline state
  const initialState: PipelineState = {
    step: { phase: "discovery", round: 1, candidates: [], searchCount: 0 },
    tokensIn: 0,
    tokensOut: 0,
    auditEntries: [],
    timings: {},
    searchCounts: {},
  };

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
      pipeline_state: initialState,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Failed to insert initial search row:", insertError);
    return Response.json({ error: "Failed to create search" }, { status: 500 });
  }

  const searchId = searchRow.id;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => sendSSE(controller, event);

      try {
        const anthropic = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });

        // Run first discovery chunk
        const discovery = await runDiscoveryChunk(
          anthropic, procedure, geography, braveSearchKey,
          [], 0, send,
        );

        const newSearchCount = discovery.searchCount;
        const moreDiscovery = newSearchCount < MAX_DISCOVERY_TOTAL_SEARCHES;

        // Determine next step
        const nextState: PipelineState = {
          step: moreDiscovery
            ? { phase: "discovery", round: 2, candidates: discovery.candidates, searchCount: newSearchCount }
            : { phase: "filtering", candidates: discovery.candidates },
          tokensIn: discovery.tokensIn,
          tokensOut: discovery.tokensOut,
          auditEntries: discovery.auditEntries,
          timings: { discoveryMs: discovery.durationMs },
          searchCounts: { discovery: newSearchCount },
        };

        await serviceClient
          .from("searches")
          .update({
            pipeline_state: nextState,
            search_count_discovery: newSearchCount,
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
