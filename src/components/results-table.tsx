"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Download,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Users,
  CheckCircle,
  XCircle,
  Lock,
} from "lucide-react";
import type { Candidate, SearchResponse } from "@/lib/types";
import { candidatesToCSV } from "@/lib/use-search";
import { VISIBLE_RESULTS_COUNT, UNLOCK_PRICE_USD } from "@/lib/constants";

interface ResultsTableProps {
  data: SearchResponse;
  searchId?: string | null;
  unlocked?: boolean;
}

function confidenceColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800 border-green-300";
  if (score >= 40) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-red-100 text-red-800 border-red-300";
}

function CandidateCard({
  candidate,
  expanded,
  onToggle,
  blurred,
}: {
  candidate: Candidate;
  expanded: boolean;
  onToggle: () => void;
  blurred?: boolean;
}) {
  const isRejected = candidate.status === "rejected";

  return (
    <div
      className={`border rounded-lg p-4 transition-colors ${
        blurred ? "select-none" : ""
      } ${
        isRejected
          ? "border-red-200 bg-red-50/30 opacity-75"
          : "hover:bg-muted/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex-1 min-w-0 ${blurred ? "blur-sm pointer-events-none" : ""}`}>
          {/* Rank + Name + Status */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">
              #{candidate.rank}
            </span>
            {isRejected ? (
              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
            ) : (
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
            )}
            <h3
              className={`font-semibold text-base truncate ${
                isRejected ? "text-muted-foreground" : ""
              }`}
            >
              {candidate.name}
            </h3>
            {!blurred && candidate.profileLink && (
              <a
                href={candidate.profileLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 shrink-0"
                title="View physician profile"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            <Badge
              variant="outline"
              className={`text-xs ml-1 ${
                isRejected
                  ? "bg-red-100 text-red-700 border-red-300"
                  : "bg-green-100 text-green-700 border-green-300"
              }`}
            >
              {isRejected ? "Rejected" : "Accepted"}
            </Badge>
          </div>

          {/* Rejection reason */}
          {isRejected && candidate.rejectionReason && (
            <p className="text-sm text-red-700 ml-8 mb-2 italic">
              {candidate.rejectionReason}
            </p>
          )}

          {/* Notes */}
          <p className="text-sm text-foreground/80 ml-8 mb-2">
            {candidate.notes}
          </p>

          {/* Key info row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 ml-8 text-sm text-muted-foreground">
            <span>{candidate.institution}</span>
            <span>&middot;</span>
            <span>{candidate.city}</span>
            <span>&middot;</span>
            <span>{candidate.specialty}</span>
          </div>

          {/* Source */}
          <div className="ml-8 mt-1 text-xs text-muted-foreground">
            <span className="font-medium">Source:</span> {candidate.source}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge
            variant="outline"
            className={`font-mono text-xs ${blurred ? "blur-sm" : confidenceColor(candidate.confidence)}`}
          >
            {candidate.confidence}
          </Badge>
          {!blurred && (
            <Button variant="ghost" size="sm" onClick={onToggle}>
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {!blurred && expanded && (
        <div className="mt-3 ml-8 space-y-2 text-sm">
          <Separator />
          <div>
            <span className="font-medium text-muted-foreground">Evidence: </span>
            <span>{candidate.evidence}</span>
          </div>
          <div>
            <span className="font-medium text-muted-foreground">Source: </span>
            <span>{candidate.source}</span>
          </div>
          {candidate.profileLink && (
            <div>
              <span className="font-medium text-muted-foreground">
                Profile:{" "}
              </span>
              <a
                href={candidate.profileLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                {candidate.profileLink}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
    link.download = `medscout_${proc}_${date}.csv`;
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
              Searches: {data.metadata.totalDiscoverySearches} discovery +{" "}
              {data.metadata.totalVettingSearches} vetting
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
              candidate={c}
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
                      candidate={c}
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
              {rejected.map((c) => (
                <CandidateCard
                  key={c.rank}
                  candidate={c}
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
