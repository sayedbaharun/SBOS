import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, ShieldX, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

interface RiskData {
  config: {
    accountStartingBalance: number;
    maxDailyLossPct: number;
    maxRiskPerTradePct: number;
    maxTradesPerDay: number;
    watchlistInstruments: string[];
  };
  today: {
    pnl: number;
    tradeCount: number;
    dailyLossUsedPct: number;
    isMaxLossBreached: boolean;
    isMaxTradesReached: boolean;
    canTrade: boolean;
  };
}

export default function RiskBudget() {
  const { data, isLoading } = useQuery<RiskData>({
    queryKey: ["/api/trading/risk-status"],
    queryFn: async () => {
      const res = await fetch("/api/trading/risk-status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-2 w-full bg-muted rounded" />
        <div className="h-4 w-32 bg-muted rounded" />
      </div>
    );
  }

  if (!data) return null;

  const { config, today } = data;
  const lossBarPct = Math.min(today.dailyLossUsedPct / config.maxDailyLossPct * 100, 100);
  const tradeBarPct = (today.tradeCount / config.maxTradesPerDay) * 100;
  const tradesLeft = Math.max(0, config.maxTradesPerDay - today.tradeCount);

  return (
    <div className="space-y-3">
      {/* Overall status */}
      <div className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
        today.isMaxLossBreached ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900"
          : today.isMaxTradesReached ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900"
      )}>
        {today.isMaxLossBreached
          ? <ShieldX className="h-4 w-4 shrink-0" />
          : today.isMaxTradesReached
          ? <ShieldAlert className="h-4 w-4 shrink-0" />
          : <ShieldCheck className="h-4 w-4 shrink-0" />}
        {today.isMaxLossBreached
          ? "Max daily loss hit — stop trading"
          : today.isMaxTradesReached
          ? "Max trades reached for today"
          : `${tradesLeft} trade${tradesLeft !== 1 ? "s" : ""} remaining today`}
      </div>

      {/* Daily loss meter */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground flex items-center gap-1">
            <TrendingDown className="h-3 w-3" />
            Daily loss used
          </span>
          <span className={cn("font-semibold tabular-nums", today.isMaxLossBreached ? "text-red-500" : "text-foreground")}>
            {today.dailyLossUsedPct.toFixed(1)}% / {config.maxDailyLossPct}%
          </span>
        </div>
        <Progress
          value={lossBarPct}
          className={cn("h-1.5", lossBarPct > 80 ? "[&>div]:bg-red-500" : lossBarPct > 50 ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500")}
        />
      </div>

      {/* Trade count meter */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Trade count</span>
          <span className="font-semibold tabular-nums">{today.tradeCount} / {config.maxTradesPerDay}</span>
        </div>
        <Progress
          value={tradeBarPct}
          className={cn("h-1.5", tradeBarPct >= 100 ? "[&>div]:bg-amber-500" : "[&>div]:bg-primary/70")}
        />
      </div>

      {/* Account context */}
      <div className="text-xs text-muted-foreground text-right">
        ${config.accountStartingBalance.toLocaleString()} account · {config.maxRiskPerTradePct}% per trade
      </div>
    </div>
  );
}
