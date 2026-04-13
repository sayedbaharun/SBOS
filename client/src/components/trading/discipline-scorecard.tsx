import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Flame, Brain, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface DisciplineData {
  today: {
    hasReview: boolean;
    followedPlan: boolean;
    noTradeIsSuccess: boolean;
    mentalState: number | null;
    tradeCount: number;
    checklistCount: number;
  };
  streak: number;
  recentDays: { date: string; followedPlan: boolean; hasReview: boolean }[];
}

function MentalStateDot({ value }: { value: number }) {
  const color = value >= 8 ? "bg-emerald-500" : value >= 6 ? "bg-amber-500" : value >= 4 ? "bg-orange-500" : "bg-red-500";
  return <span className={cn("inline-block h-2 w-2 rounded-full", color)} title={`Mental state: ${value}/10`} />;
}

export default function DisciplineScorecard() {
  const { data, isLoading } = useQuery<DisciplineData>({
    queryKey: ["/api/trading/discipline"],
    queryFn: async () => {
      const res = await fetch("/api/trading/discipline", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-8 w-24 bg-muted rounded" />
        <div className="flex gap-1">
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-5 w-5 bg-muted rounded" />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { today, streak, recentDays } = data;

  return (
    <div className="space-y-3">
      {/* Streak badge */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold",
          streak >= 5 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : streak >= 2 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        )}>
          <Flame className="h-4 w-4" />
          {streak} day{streak !== 1 ? "s" : ""} streak
        </div>
        {today.mentalState && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Brain className="h-3.5 w-3.5" />
            <MentalStateDot value={today.mentalState} />
            <span>{today.mentalState}/10</span>
          </div>
        )}
      </div>

      {/* Today's checks */}
      {today.checklistCount > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Today</p>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-sm">
              {today.followedPlan
                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                : today.hasReview
                ? <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                : <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 shrink-0" />}
              <span className={cn(today.followedPlan ? "text-foreground" : today.hasReview ? "text-muted-foreground line-through" : "text-muted-foreground")}>
                Followed plan
              </span>
            </div>
            {today.noTradeIsSuccess && (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span>No-trade discipline</span>
              </div>
            )}
          </div>
        </div>
      )}

      {today.checklistCount === 0 && (
        <p className="text-xs text-muted-foreground">No checklist today. Start one in the Trading Hub.</p>
      )}

      {/* Recent 7-day mini-calendar */}
      {recentDays.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Last 7 days</p>
          <div className="flex gap-1">
            {recentDays.slice(0, 7).map((d, i) => {
              const dotDate = new Date(d.date + "T12:00:00Z");
              const dayLabel = dotDate.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 1);
              return (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <div className={cn(
                    "h-5 w-5 rounded-sm flex items-center justify-center",
                    !d.hasReview ? "bg-muted/40"
                      : d.followedPlan ? "bg-emerald-500/20 border border-emerald-300/60 dark:border-emerald-800"
                      : "bg-red-500/20 border border-red-300/60 dark:border-red-800"
                  )}>
                    {d.hasReview && (
                      d.followedPlan
                        ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        : <XCircle className="h-3 w-3 text-red-500" />
                    )}
                  </div>
                  <span className="text-[9px] text-muted-foreground">{dayLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
