"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Download,
  ChevronDown,
  ChevronUp,
  Users,
  XCircle,
  Lock,
  Loader2,
  Square,
} from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import type { LiveCandidate } from "@/lib/types";
import type { LiveSearchState } from "@/lib/use-search";
import { candidatesToCSV } from "@/lib/use-search";
import { CandidateCard } from "@/components/candidate-card";
import { VISIBLE_RESULTS_COUNT, UNLOCK_PRICE_USD } from "@/lib/constants";

interface LiveLeaderboardProps {
  live: LiveSearchState;
  onStop?: () => void;
  unlocked?: boolean;
}

function sortCandidates(candidates: Map<string, LiveCandidate>): LiveCandidate[] {
  const arr = Array.from(candidates.values());

  // Scored candidates sort to top by score desc, then unscored in insertion order
  return arr.sort((a, b) => {
    const aScored = a.research?.score != null && a.research.score > 0;
    const bScored = b.research?.score != null && b.research.score > 0;

    if (aScored && bScored) {
      // Both scored — if ranked, use rank; otherwise sort by score desc
      if (a.rank != null && b.rank != null && a.rank > 0 && b.rank > 0) {
        return a.rank - b.rank;
      }
      return b.research!.score - a.research!.score;
    }
    if (aScored) return -1;
    if (bScored) return 1;
    return 0; // Both unscored — preserve insertion order (Map iteration order)
  });
}

export function LiveLeaderboard({ live, onStop, unlocked = false }: LiveLeaderboardProps) {
  const [expandedNames, setExpandedNames] = useState<Set<string>>(new Set());
  const [showRejected, setShowRejected] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const isDone = live.phase === "done";
  const sorted = sortCandidates(live.candidates);
  const rejected = live.rejected;

  const visibleCandidates = unlocked ? sorted : sorted.slice(0, VISIBLE_RESULTS_COUNT);
  const blurredCandidates = unlocked ? [] : sorted.slice(VISIBLE_RESULTS_COUNT);
  const hasBlurred = blurredCandidates.length > 0;

  const progressPercent =
    live.current != null && live.total != null && live.total > 0
      ? Math.round((live.current / live.total) * 100)
      : undefined;

  const phaseLabel =
    live.phase === "discovery"
      ? "Discovering candidates"
      : live.phase === "filtering"
        ? "Filtering candidates"
        : live.phase === "research"
          ? "Researching candidates"
          : "Results";

  const toggleExpand = (name: string) => {
    setExpandedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleDownload = () => {
    if (!live.finalResponse) return;
    const data = live.finalResponse;
    const downloadCandidates = unlocked
      ? data.candidates
      : data.candidates.slice(0, VISIBLE_RESULTS_COUNT);
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
    if (!live.searchId) return;
    setUnlocking(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchId: live.searchId }),
      });
      const { url } = await res.json();
      if (url) {
        window.location.href = url;
      }
    } catch {
      // handle error silently
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {!isDone && (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              {isDone && <Users className="h-5 w-5" />}
              {isDone
                ? `Accepted: ${sorted.length} professionals`
                : phaseLabel}
            </CardTitle>
            <div className="flex items-center gap-2">
              {isDone && live.finalResponse && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                  className="bg-orange-500 text-white border-orange-500 hover:bg-orange-600 hover:text-white"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download CSV
                </Button>
              )}
              {!isDone && onStop && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onStop}
                >
                  <Square className="h-3 w-3 mr-1.5 fill-current" />
                  Stop
                </Button>
              )}
            </div>
          </div>

          {!isDone && progressPercent !== undefined && (
            <Progress value={progressPercent} className="mt-2" />
          )}

          {!isDone && (
            <p className="text-sm text-muted-foreground mt-1">{live.message}</p>
          )}

          {isDone && live.finalResponse && (
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Procedure: {live.finalResponse.metadata.procedure}</span>
              {live.finalResponse.metadata.geography && (
                <span>Region: {live.finalResponse.metadata.geography}</span>
              )}
              <span>
                Searches: {live.finalResponse.metadata.searchCountDiscovery} discovery +{" "}
                {live.finalResponse.metadata.searchCountFiltering} filtering +{" "}
                {live.finalResponse.metadata.searchCountResearch} research
              </span>
              <span>
                Total candidates: {sorted.length + rejected.length} ({sorted.length}{" "}
                accepted, {rejected.length} rejected)
              </span>
            </div>
          )}

          {!isDone && (
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{sorted.length} candidate{sorted.length !== 1 ? "s" : ""}</span>
              {live.current != null && live.total != null && (
                <span className="font-mono">{live.current} of {live.total}</span>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent className="space-y-3">
          <LayoutGroup>
            <AnimatePresence mode="popLayout">
              {visibleCandidates.map((c) => (
                <motion.div
                  key={c.name}
                  layout
                  layoutId={c.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{
                    layout: { type: "spring", stiffness: 300, damping: 30 },
                    opacity: { duration: 0.2 },
                  }}
                  className="mb-3 last:mb-0"
                >
                  <CandidateCard
                    candidate={c}
                    expanded={expandedNames.has(c.name)}
                    onToggle={() => toggleExpand(c.name)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </LayoutGroup>

          {/* Blurred results + unlock CTA */}
          {hasBlurred && (
            <div className="relative">
              <div className="space-y-3">
                {blurredCandidates.slice(0, 3).map((c) => (
                  <CandidateCard
                    key={c.name}
                    candidate={c}
                    expanded={false}
                    onToggle={() => {}}
                    blurred
                  />
                ))}
              </div>

              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-transparent via-background/80 to-background rounded-lg">
                <div className="text-center space-y-3 p-6">
                  <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {blurredCandidates.length} more results available
                  </p>
                  {isDone && (
                    <Button
                      onClick={handleUnlock}
                      disabled={unlocking || !live.searchId}
                      className="bg-orange-500 text-white hover:bg-orange-600"
                      size="lg"
                    >
                      {unlocking
                        ? "Redirecting to payment..."
                        : `Pay $${UNLOCK_PRICE_USD} to unlock full results`}
                    </Button>
                  )}
                </div>
              </div>
            </div>
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
                  candidate={c}
                  expanded={expandedNames.has(c.name)}
                  onToggle={() => toggleExpand(c.name)}
                />
              ))}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
