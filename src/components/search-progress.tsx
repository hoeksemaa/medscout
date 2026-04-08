"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

interface SearchProgressProps {
  phase: "discovery" | "filtering" | "research";
  message: string;
  names: string[];
  current?: number;
  total?: number;
}

export function SearchProgress({
  phase,
  message,
  names,
  current,
  total,
}: SearchProgressProps) {
  const phaseLabel =
    phase === "discovery"
      ? "Discovering candidates"
      : phase === "filtering"
        ? "Filtering candidates"
        : "Researching candidates";

  const progressPercent =
    current && total ? Math.round((current / total) * 100) : undefined;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3 mb-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="font-medium">{phaseLabel}</span>
          {current != null && total != null && (
            <span className="ml-auto text-sm text-muted-foreground font-mono">
              {current} of {total}
            </span>
          )}
        </div>

        {progressPercent !== undefined && (
          <Progress value={progressPercent} className="mb-3" />
        )}

        <p className="text-sm text-muted-foreground mb-3">{message}</p>

        {names.length > 0 && (
          <div className="max-h-48 overflow-y-auto border rounded-md p-3 bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {names.length} candidate{names.length !== 1 ? "s" : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {names.map((name, i) => (
                <span
                  key={i}
                  className="text-xs bg-background border rounded px-2 py-0.5"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
