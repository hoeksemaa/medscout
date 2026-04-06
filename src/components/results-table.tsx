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
} from "lucide-react";
import type { Candidate, SearchResponse } from "@/lib/types";
import { candidatesToCSV } from "@/lib/use-search";

interface ResultsTableProps {
  data: SearchResponse;
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
}: {
  candidate: Candidate;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isRejected = candidate.status === "rejected";

  return (
    <div
      className={`border rounded-lg p-4 transition-colors ${
        isRejected
          ? "border-red-200 bg-red-50/30 opacity-75"
          : "hover:bg-muted/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
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
            {candidate.profileLink && (
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

          {/* Rejection reason — prominent for rejected candidates */}
          {isRejected && candidate.rejectionReason && (
            <p className="text-sm text-red-700 ml-8 mb-2 italic">
              {candidate.rejectionReason}
            </p>
          )}

          {/* Notes — second most prominent element */}
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

          {/* Source — always visible */}
          <div className="ml-8 mt-1 text-xs text-muted-foreground">
            <span className="font-medium">Source:</span> {candidate.source}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge
            variant="outline"
            className={`font-mono text-xs ${confidenceColor(candidate.confidence)}`}
          >
            {candidate.confidence}
          </Badge>
          <Button variant="ghost" size="sm" onClick={onToggle}>
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {expanded && (
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

export function ResultsTable({ data }: ResultsTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [showRejected, setShowRejected] = useState(false);

  const accepted = data.candidates.filter((c) => c.status === "accepted");
  const rejected = data.candidates.filter((c) => c.status === "rejected");

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
    const csv = candidatesToCSV(data.candidates, data.metadata.procedure);
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
          {accepted.map((c) => (
            <CandidateCard
              key={c.rank}
              candidate={c}
              expanded={expandedIds.has(c.rank)}
              onToggle={() => toggleExpand(c.rank)}
            />
          ))}
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
