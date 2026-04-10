"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Download,
  ChevronDown,
  ChevronUp,
  Users,
  XCircle,
  Lock,
} from "lucide-react";
import type { SearchResponse } from "@/lib/types";
import { candidatesToCSV } from "@/lib/use-search";
import { VISIBLE_RESULTS_COUNT, UNLOCK_PRICE_USD } from "@/lib/constants";
import { CandidateCard, candidateToLive } from "@/components/candidate-card";

interface ResultsTableProps {
  data: SearchResponse;
  searchId?: string | null;
  unlocked?: boolean;
}

export function ResultsTable({ data, searchId, unlocked = false }: ResultsTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [showRejected, setShowRejected] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const accepted = data.candidates.filter((c) => c.status === "accepted");
  const rejected = data.candidates.filter((c) => c.status === "rejected");

  const visibleAccepted = unlocked ? accepted : accepted.slice(0, VISIBLE_RESULTS_COUNT);
  const blurredAccepted = unlocked ? [] : accepted.slice(VISIBLE_RESULTS_COUNT);
  const hasBlurred = blurredAccepted.length > 0;

  const toggleExpand = (rank: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rank)) {
        next.delete(rank);
      } else {
        next.add(rank);
      }
      return next;
    });
  };

  const handleDownload = () => {
    const downloadCandidates = unlocked ? data.candidates : data.candidates.slice(0, VISIBLE_RESULTS_COUNT);
    const csv = candidatesToCSV(downloadCandidates, data.metadata.procedure);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    const proc = data.metadata.procedure.replace(/\s+/g, "_").toLowerCase();
    link.href = url;
    link.download = `dr-yellowpages_${proc}_${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleUnlock = async () => {
    if (!searchId) return;
    setUnlocking(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchId }),
      });
      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
    } catch {
      // handle error silently for now
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Accepted */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Accepted: {accepted.length} professionals
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="bg-orange-500 text-white border-orange-500 hover:bg-orange-600 hover:text-white"
            >
              <Download className="h-4 w-4 mr-2" />
              Download CSV
            </Button>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>Procedure: {data.metadata.procedure}</span>
            {data.metadata.geography && (
              <span>Region: {data.metadata.geography}</span>
            )}
            <span>
              Searches: {data.metadata.searchCountDiscovery} discovery +{" "}
              {data.metadata.searchCountFiltering} filtering +{" "}
              {data.metadata.searchCountResearch} research
            </span>
            <span>
              Total candidates: {data.candidates.length} ({accepted.length}{" "}
              accepted, {rejected.length} rejected)
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Visible results */}
          {visibleAccepted.map((c) => (
            <CandidateCard
              key={c.rank}
              candidate={candidateToLive(c)}
              expanded={expandedIds.has(c.rank)}
              onToggle={() => toggleExpand(c.rank)}
            />
          ))}

          {/* Blurred results + unlock CTA */}
          {hasBlurred && (
            <>
              <div className="relative">
                <div className="space-y-3">
                  {blurredAccepted.slice(0, 3).map((c) => (
                    <CandidateCard
                      key={c.rank}
                      candidate={candidateToLive(c)}
                      expanded={false}
                      onToggle={() => {}}
                      blurred
                    />
                  ))}
                </div>

                {/* Overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-transparent via-background/80 to-background rounded-lg">
                  <div className="text-center space-y-3 p-6">
                    <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {blurredAccepted.length} more results available
                    </p>
                    <Button
                      onClick={handleUnlock}
                      disabled={unlocking || !searchId}
                      className="bg-orange-500 text-white hover:bg-orange-600"
                      size="lg"
                    >
                      {unlocking
                        ? "Redirecting to payment..."
                        : `Pay $${UNLOCK_PRICE_USD} to unlock full results`}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Rejected */}
      {rejected.length > 0 && (
        <Card>
          <CardHeader>
            <Button
              variant="ghost"
              className="w-full justify-between"
              onClick={() => setShowRejected(!showRejected)}
            >
              <span className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-4 w-4 text-red-500" />
                Rejected: {rejected.length} candidates
              </span>
              {showRejected ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CardHeader>
          {showRejected && (
            <CardContent className="space-y-3">
              {rejected.map((c, i) => (
                <CandidateCard
                  key={`rejected-${i}`}
                  candidate={candidateToLive(c)}
                  expanded={expandedIds.has(c.rank)}
                  onToggle={() => toggleExpand(c.rank)}
                />
              ))}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
