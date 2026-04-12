import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Clock, Bot, Eye } from "lucide-react";

interface DailyBriefData {
  date: string;
  headline: string;
  bullets: string[];
  agentReadyCount: number;
  reviewPendingCount: number;
  generatedAt?: string;
  agentSlug?: string;
}

export function MorningBriefWidget() {
  const { data, isLoading } = useQuery<DailyBriefData>({
    queryKey: ["morning-brief"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/morning-brief", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch morning brief");
      return res.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const hasBrief = data?.generatedAt != null;

  const dateLabel = data?.date
    ? new Date(data.date + "T00:00:00").toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  const generatedTime = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Card className="border-border/50 overflow-hidden">
      {/* Amber-to-orange gradient top border */}
      <div className="h-0.5 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-orange-500" />

      <CardHeader className="pb-2 pt-3 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <span className="text-base leading-none">☀️</span>
          Morning Brief
        </CardTitle>
        <div className="flex items-center gap-1.5">
          {dateLabel && (
            <Badge
              variant="outline"
              className="text-[10px] h-4 px-1.5 border-border/60 text-muted-foreground font-normal"
            >
              {dateLabel}
            </Badge>
          )}
          {generatedTime && (
            <span className="text-[10px] text-muted-foreground tabular-nums">{generatedTime}</span>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-1 space-y-2.5">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-4/6" />
          </div>
        ) : !hasBrief ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Clock className="h-4 w-4 shrink-0 opacity-50" />
            <span>No brief yet — will generate at 7am.</span>
          </div>
        ) : (
          <>
            {/* Headline */}
            <p className="text-sm font-semibold leading-snug text-foreground">
              {data!.headline}
            </p>

            {/* Bullet list */}
            {data!.bullets.length > 0 && (
              <ul className="space-y-1.5">
                {data!.bullets.map((bullet, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground leading-snug">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500/70" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Count badges */}
            {(data!.agentReadyCount > 0 || data!.reviewPendingCount > 0) && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {data!.agentReadyCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] h-5 px-1.5 gap-1 bg-blue-500/15 text-blue-400 border border-blue-500/25 hover:bg-blue-500/20"
                  >
                    <Bot className="h-2.5 w-2.5" />
                    {data!.agentReadyCount} ready for agents
                  </Badge>
                )}
                {data!.reviewPendingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] h-5 px-1.5 gap-1 bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/20"
                  >
                    <Eye className="h-2.5 w-2.5" />
                    {data!.reviewPendingCount} pending review
                  </Badge>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
