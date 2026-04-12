import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { relativeTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, ScanLine } from "lucide-react";

interface Decision {
  id: string;
  agentSlug: string;
  action: string;
  inputs: Record<string, unknown> | null;
  output: string | null;
  status: string;
  createdAt: string;
}

function inputSummary(inputs: Record<string, unknown> | null): string {
  if (!inputs) return "—";
  try {
    const text = JSON.stringify(inputs);
    return text.length > 60 ? text.slice(0, 57) + "..." : text;
  } catch {
    return "—";
  }
}

interface DecisionTracePanelProps {
  agentSlug: string;
}

export function DecisionTracePanel({ agentSlug }: DecisionTracePanelProps) {
  const { data: decisions = [], isLoading } = useQuery<Decision[]>({
    queryKey: ["/api/decisions", agentSlug],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/decisions?agentSlug=${encodeURIComponent(agentSlug)}&limit=10`
      );
      return res.json();
    },
    refetchInterval: 30_000,
    enabled: !!agentSlug,
  });

  return (
    <Card className="border border-border/40 bg-muted/10">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <ScanLine className="h-3.5 w-3.5" />
          Decision Trace
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs max-w-[220px]">
                Records every tool invocation by this agent
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : decisions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/50 mb-2.5">
              <ScanLine className="h-4 w-4 text-muted-foreground/40" />
            </div>
            <p className="text-[12px] text-muted-foreground max-w-[260px] leading-relaxed">
              No decisions recorded yet — decisions appear here when this agent invokes tools.
            </p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
            {decisions.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-muted/30 transition-colors group"
              >
                {/* Action badge */}
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] px-1.5 py-0 bg-muted/60 border-border/40 text-foreground/70 flex-shrink-0 whitespace-nowrap"
                >
                  {d.action}
                </Badge>

                {/* Inputs summary */}
                <span className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">
                  {inputSummary(d.inputs)}
                </span>

                {/* Timestamp */}
                <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 tabular-nums">
                  {relativeTime(d.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
