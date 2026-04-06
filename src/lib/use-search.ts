"use client";

import { useState, useCallback } from "react";
import type { Candidate, SearchResponse, SSEEvent } from "./types";

export type SearchState =
  | { status: "idle" }
  | {
      status: "searching";
      phase: "discovery" | "vetting" | "scoring";
      message: string;
      current?: number;
      total?: number;
    }
  | { status: "results"; data: SearchResponse }
  | { status: "error"; message: string };

export function useSearch() {
  const [state, setState] = useState<SearchState>({ status: "idle" });

  const search = useCallback(
    async (params: {
      anthropicKey: string;
      braveSearchKey: string;
      procedure: string;
      region?: string;
      countries?: string[];
      resultCount: number;
    }) => {
      setState({
        status: "searching",
        phase: "discovery",
        message: "Starting search...",
      });

      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!res.ok) {
          const err = await res.json();
          setState({
            status: "error",
            message: err.error || `HTTP ${res.status}`,
          });
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setState({ status: "error", message: "No response stream" });
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
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

              if (event.type === "progress") {
                setState({
                  status: "searching",
                  phase: event.phase,
                  message: event.message,
                  current: event.current,
                  total: event.total,
                });
              } else if (event.type === "result") {
                setState({ status: "results", data: event.data });
              } else if (event.type === "error") {
                setState({ status: "error", message: event.message });
              }
            } catch {
              // skip unparseable events
            }
          }
        }
      } catch (err) {
        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : "Network error occurred",
        });
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, search, reset };
}

export function candidatesToCSV(
  candidates: Candidate[],
  procedure: string
): string {
  const headers = [
    "Rank",
    "Status",
    "Name",
    "Notes",
    "Institution",
    "City",
    "Specialty",
    "Evidence",
    "Source",
    "Profile Link",
    "Confidence",
    "Rejection Reason",
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
      c.notes,
      c.institution,
      c.city,
      c.specialty,
      c.evidence,
      c.source,
      c.profileLink ?? "",
      c.confidence,
      c.rejectionReason ?? "",
    ]
      .map(escapeCSV)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
