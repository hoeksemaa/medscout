"use client";

import { useState, useCallback, useRef } from "react";
import type { Candidate, SearchResponse, SSEEvent } from "./types";

export type SearchState =
  | { status: "idle" }
  | {
      status: "searching";
      phase: "discovery" | "filtering" | "research";
      message: string;
      names: string[];
      current?: number;
      total?: number;
    }
  | { status: "results"; data: SearchResponse; searchId: string | null }
  | { status: "error"; message: string };

/** Read an SSE stream, dispatch events, return the last chunk_done searchId or null */
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

export function useSearch() {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

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

      setState({
        status: "searching",
        phase: "discovery",
        message: "Starting search...",
        names: [],
      });

      let currentNames: string[] = [];

      const handleEvent = (event: SSEEvent) => {
        if (signal.aborted) return;

        if (event.type === "progress") {
          setState({
            status: "searching",
            phase: event.phase,
            message: event.message,
            names: currentNames,
            current: event.current,
            total: event.total,
          });
        } else if (event.type === "candidates_discovered") {
          currentNames = event.names;
          setState((prev) =>
            prev.status === "searching"
              ? { ...prev, names: event.names }
              : prev,
          );
        } else if (event.type === "candidates_filtered") {
          currentNames = event.names;
          setState((prev) =>
            prev.status === "searching"
              ? { ...prev, names: event.names }
              : prev,
          );
        } else if (event.type === "result") {
          setState({
            status: "results",
            data: event.data,
            searchId: event.searchId ?? null,
          });
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
