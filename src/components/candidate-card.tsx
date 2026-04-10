"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ExternalLink,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
} from "lucide-react";
import type { Candidate, LiveCandidate } from "@/lib/types";

export function scoreColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800 border-green-300";
  if (score >= 40) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-red-100 text-red-800 border-red-300";
}

export function stageLabel(stage?: string): string {
  switch (stage) {
    case "filtering": return "Filtered";
    case "research": return "Research";
    case "score": return "Ranking";
    default: return "Rejected";
  }
}

export function candidateToLive(c: Candidate): LiveCandidate {
  return {
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
      disqualified: c.status === "rejected",
      disqualificationReason: c.rejectionReason,
    },
    rank: c.rank,
    finalStatus: c.status,
    rejectionReason: c.rejectionReason,
    rejectionStage: c.rejectionStage,
  };
}

export function CandidateCard({
  candidate,
  expanded,
  onToggle,
  blurred,
}: {
  candidate: LiveCandidate;
  expanded: boolean;
  onToggle: () => void;
  blurred?: boolean;
}) {
  const hasResearch = candidate.phase === "researched" || candidate.phase === "ranked";
  const r = candidate.research;
  const isRejected = candidate.finalStatus === "rejected";
  const isRanked = candidate.phase === "ranked";
  const score = r?.score ?? 0;
  const name = candidate.name;
  const summary = r?.summary ?? "";
  const institution = r?.institution ?? "";
  const city = r?.city ?? "";
  const specialty = r?.specialty ?? "";
  const source = r?.source ?? "";
  const profileLink = r?.profileLink ?? null;
  const evidence = r?.evidence ?? "";

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
            {isRanked && candidate.rank != null && candidate.rank > 0 && (
              <span className="text-xs font-mono text-muted-foreground w-6 shrink-0">
                #{candidate.rank}
              </span>
            )}
            {hasResearch && (
              isRejected ? (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              ) : (
                <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
              )
            )}
            <h3
              className={`font-semibold text-base truncate ${
                isRejected ? "text-muted-foreground" : ""
              }`}
            >
              {name}
            </h3>
            {!blurred && profileLink && (
              <a
                href={profileLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 shrink-0"
                title="View physician profile"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {isRanked && (
              <Badge
                variant="outline"
                className={`text-xs ml-1 ${
                  isRejected
                    ? "bg-red-100 text-red-700 border-red-300"
                    : "bg-green-100 text-green-700 border-green-300"
                }`}
              >
                {isRejected ? stageLabel(candidate.rejectionStage) : "Accepted"}
              </Badge>
            )}
            {!hasResearch && (
              <span className="text-xs text-muted-foreground italic ml-1">
                Awaiting research...
              </span>
            )}
          </div>

          {/* Rejection reason */}
          {isRejected && candidate.rejectionReason && (
            <p className="text-sm text-red-700 ml-8 mb-2 italic">
              {candidate.rejectionReason}
            </p>
          )}

          {/* Summary */}
          {hasResearch && summary && (
            <p className="text-sm text-foreground/80 ml-8 mb-2">
              {summary}
            </p>
          )}

          {/* Key info row */}
          {hasResearch && institution && institution !== "Unknown" && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 ml-8 text-sm text-muted-foreground">
              <span>{institution}</span>
              {city && city !== "Unknown" && (
                <>
                  <span>&middot;</span>
                  <span>{city}</span>
                </>
              )}
              {specialty && specialty !== "Unknown" && (
                <>
                  <span>&middot;</span>
                  <span>{specialty}</span>
                </>
              )}
            </div>
          )}

          {/* Source */}
          {hasResearch && source && (
            <div className="ml-8 mt-1 text-xs text-muted-foreground">
              <span className="font-medium">Source:</span> {source}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          {hasResearch && score > 0 && (
            <Badge
              variant="outline"
              className={`font-mono text-xs ${blurred ? "blur-sm" : scoreColor(score)}`}
            >
              {score}
            </Badge>
          )}
          {!blurred && hasResearch && summary && (
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

      {!blurred && expanded && hasResearch && (
        <div className="mt-3 ml-8 space-y-2 text-sm">
          <Separator />
          {evidence && (
            <div>
              <span className="font-medium text-muted-foreground">Evidence: </span>
              <span>{evidence}</span>
            </div>
          )}
          {source && (
            <div>
              <span className="font-medium text-muted-foreground">Source: </span>
              <span>{source}</span>
            </div>
          )}
          {profileLink && (
            <div>
              <span className="font-medium text-muted-foreground">Profile: </span>
              <a
                href={profileLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                {profileLink}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
