"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

interface SearchProgressProps {
  phase: "discovery" | "vetting" | "scoring";
  message: string;
  current?: number;
  total?: number;
}

export function SearchProgress({
  phase,
  message,
  current,
  total,
}: SearchProgressProps) {
  const phaseLabel =
    phase === "discovery"
      ? "Discovering candidates"
      : phase === "vetting"
        ? "Verifying candidates"
        : "Scoring & ranking";

  const progressPercent =
    current && total ? Math.round((current / total) * 100) : undefined;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3 mb-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="font-medium">{phaseLabel}</span>
          {current && total && (
            <span className="ml-auto text-sm text-muted-foreground font-mono">
              {current} of {total}
            </span>
          )}
        </div>

        {progressPercent !== undefined && (
          <Progress value={progressPercent} className="mb-3" />
        )}

        <p className="text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
