"use client";

import { useState, useCallback, useRef } from "react";
import type {
  Candidate,
  SearchResponse,
  SSEEvent,
  LiveCandidate,
  CandidatePhase,
} from "./types";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export interface LiveSearchState {
  phase: "discovery" | "filtering" | "research" | "done";
  candidates: Map<string, LiveCandidate>;
  rejected: LiveCandidate[];
  message: string;
  current?: number;
  total?: number;
  searchId?: string | null;
  finalResponse?: SearchResponse;
}

export type SearchState =
  | { status: "idle" }
  | { status: "live"; live: LiveSearchState }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// SSE stream consumer (unchanged wire format)
// ---------------------------------------------------------------------------

async function consumeSSEStream(
  res: Response,
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buffer = "";
  let chunkDoneSearchId: string | null = null;

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        return null;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const json = trimmed.slice(6);

        try {
          const event: SSEEvent = JSON.parse(json);
          onEvent(event);

          if (event.type === "chunk_done") {
            chunkDoneSearchId = event.searchId;
          }
        } catch {
          // skip unparseable
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return null;
    throw err;
  }

  return chunkDoneSearchId;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSearch() {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  // Mutable refs that persist across chunk boundaries
  const candidatesRef = useRef(new Map<string, LiveCandidate>());
  const rejectedRef = useRef<LiveCandidate[]>([]);
  const phaseRef = useRef<LiveSearchState["phase"]>("discovery");
  const searchIdRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }, []);

  const search = useCallback(
    async (params: {
      procedure: string;
      region?: string;
      countries?: string[];
    }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;

      // Reset refs
      candidatesRef.current = new Map();
      rejectedRef.current = [];
      phaseRef.current = "discovery";
      searchIdRef.current = null;

      let currentMessage = "Starting search...";

      const emitState = (extras?: Partial<LiveSearchState>) => {
        setState({
          status: "live",
          live: {
            phase: phaseRef.current,
            candidates: new Map(candidatesRef.current),
            rejected: [...rejectedRef.current],
            message: currentMessage,
            searchId: searchIdRef.current,
            ...extras,
          },
        });
      };

      setState({
        status: "live",
        live: {
          phase: "discovery",
          candidates: new Map(),
          rejected: [],
          message: currentMessage,
        },
      });

      const handleEvent = (event: SSEEvent) => {
        if (signal.aborted) return;

        if (event.type === "progress") {
          phaseRef.current = event.phase;
          currentMessage = event.message;
          emitState({ current: event.current, total: event.total });

        } else if (event.type === "candidates_discovered") {
          const map = candidatesRef.current;
          for (const name of event.names) {
            if (!map.has(name)) {
              map.set(name, { name, phase: "discovered" });
            }
          }
          emitState();

        } else if (event.type === "candidates_filtered") {
          const map = candidatesRef.current;
          const surviving = new Set(event.names);
          // Remove candidates not in the filtered list
          for (const [name] of map) {
            if (!surviving.has(name)) {
              map.delete(name);
            }
          }
          // Add any new names from filtering (name normalization)
          for (const name of event.names) {
            if (!map.has(name)) {
              map.set(name, { name, phase: "filtered" });
            } else {
              const c = map.get(name)!;
              map.set(name, { ...c, phase: "filtered" });
            }
          }
          emitState();

        } else if (event.type === "candidates_rejected") {
          for (const r of event.rejections) {
            candidatesRef.current.delete(r.name);
            rejectedRef.current.push({
              name: r.name,
              phase: "ranked",
              finalStatus: "rejected",
              rejectionReason: r.reason,
              rejectionStage: "filtering",
            });
          }
          emitState();

        } else if (event.type === "candidate_researched") {
          const rc = event.candidate;
          if (rc.disqualified) {
            candidatesRef.current.delete(rc.name);
            rejectedRef.current.push({
              name: rc.name,
              phase: "researched",
              research: rc,
              finalStatus: "rejected",
              rejectionReason: rc.disqualificationReason ?? "Disqualified during research",
              rejectionStage: "research",
            });
          } else {
            candidatesRef.current.set(rc.name, {
              name: rc.name,
              phase: "researched",
              research: rc,
            });
          }
          emitState();

        } else if (event.type === "result") {
          // Update all candidates with final rank/status from SearchResponse
          const map = candidatesRef.current;
          const newRejected = [...rejectedRef.current];

          for (const c of event.data.candidates) {
            if (c.status === "accepted") {
              const existing = map.get(c.name);
              map.set(c.name, {
                name: c.name,
                phase: "ranked",
                research: existing?.research ?? {
                  name: c.name,
                  summary: c.summary,
                  evidence: c.evidence,
                  score: c.score,
                  institution: c.institution,
                  city: c.city,
                  specialty: c.specialty,
                  source: c.source,
                  profileLink: c.profileLink,
                  disqualified: false,
                },
                rank: c.rank,
                finalStatus: "accepted",
              });
            } else if (c.status === "rejected") {
              // Move to rejected list if still in main map
              map.delete(c.name);
              // Only add if not already in rejected list
              if (!newRejected.some((r) => r.name === c.name)) {
                newRejected.push({
                  name: c.name,
                  phase: "ranked",
                  research: {
                    name: c.name,
                    summary: c.summary,
                    evidence: c.evidence,
                    score: c.score,
                    institution: c.institution,
                    city: c.city,
                    specialty: c.specialty,
                    source: c.source,
                    profileLink: c.profileLink,
                    disqualified: true,
                    disqualificationReason: c.rejectionReason,
                  },
                  rank: c.rank,
                  finalStatus: "rejected",
                  rejectionReason: c.rejectionReason,
                  rejectionStage: c.rejectionStage,
                });
              }
            }
          }

          rejectedRef.current = newRejected;
          phaseRef.current = "done";
          searchIdRef.current = event.searchId ?? null;

          emitState({ finalResponse: event.data });

        } else if (event.type === "error") {
          setState({ status: "error", message: event.message });
        }
      };

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
          signal,
        });

        if (signal.aborted) return;

        if (!res.ok) {
          const err = await res.json();
          setState({ status: "error", message: err.error || `HTTP ${res.status}` });
          return;
        }

        let searchId = await consumeSSEStream(res, handleEvent, signal);

        while (searchId && !signal.aborted) {
          searchIdRef.current = searchId;

          const continueRes = await fetch("/api/search/continue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ searchId }),
            signal,
          });

          if (signal.aborted) return;

          if (!continueRes.ok) {
            const err = await continueRes.json();
            setState({ status: "error", message: err.error || `HTTP ${continueRes.status}` });
            return;
          }

          searchId = await consumeSSEStream(continueRes, handleEvent, signal);
        }
      } catch (err) {
        if (signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Network error occurred",
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
  }, []);

  return { state, search, stop, reset };
}

// ---------------------------------------------------------------------------
// CSV export (unchanged)
// ---------------------------------------------------------------------------

export function candidatesToCSV(
  candidates: Candidate[],
  procedure: string,
): string {
  const headers = [
    "Rank",
    "Status",
    "Name",
    "Summary",
    "Institution",
    "City",
    "Specialty",
    "Evidence",
    "Source",
    "Profile Link",
    "Score",
    "Rejection Reason",
    "Rejection Stage",
  ];

  const escapeCSV = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = candidates.map((c) =>
    [
      c.rank,
      c.status ?? "accepted",
      c.name,
      c.summary,
      c.institution,
      c.city,
      c.specialty,
      c.evidence,
      c.source,
      c.profileLink ?? "",
      c.score,
      c.rejectionReason ?? "",
      c.rejectionStage ?? "",
    ]
      .map(escapeCSV)
      .join(","),
  );

  return [headers.join(","), ...rows].join("\n");
}
