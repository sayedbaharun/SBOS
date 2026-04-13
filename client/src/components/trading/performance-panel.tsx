import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

interface InstrumentStat {
  key: string;
  wins: number;
  losses: number;
  be: number;
  totalPnl: number;
  winRate: number | null;
  trades: number;
}

interface SessionStat extends InstrumentStat {
  label?: string;
}

interface PerformanceData {
  overall: {
    totalTrades: number;
    wins: number;
    losses: number;
    be: number;
    winRate: number | null;
    expectancy: number | null;
    totalPnl: number;
  };
  byInstrument: InstrumentStat[];
  bySession: SessionStat[];
  byDOW: (InstrumentStat & { label: string })[];
  windowDays: number;
}

const SESSION_LABELS: Record<string, string> = {
  london: "London",
  new_york: "New York",
  asian: "Asian",
  other: "Other",
};

function StatBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function WinRateBadge({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className={cn("text-xs font-semibold tabular-nums", rate >= 60 ? "text-emerald-500" : rate >= 50 ? "text-amber-500" : "text-red-500")}>
      {rate}%
    </span>
  );
}

export default function PerformancePanel() {
  const { data, isLoading } = useQuery<PerformanceData>({
    queryKey: ["/api/trading/performance"],
    queryFn: async () => {
      const res = await fetch("/api/trading/performance", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 15 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-4 w-32 bg-muted rounded" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-muted rounded" />)}
        </div>
      </div>
    );
  }

  if (!data || data.overall.totalTrades === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No closed trades in the last 90 days. Start logging to see your edge.
      </p>
    );
  }

  const { overall, byInstrument, bySession, byDOW } = data;
  const maxTrades = Math.max(...byInstrument.map((b) => b.trades), 1);

  return (
    <div className="space-y-5">
      {/* Overall stats strip */}
      <div className="grid grid-cols-4 gap-2 p-3 rounded-lg bg-muted/30 border border-border/50">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Trades</p>
          <p className="text-lg font-bold">{overall.totalTrades}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Win Rate</p>
          <p className={cn("text-lg font-bold", (overall.winRate ?? 0) >= 60 ? "text-emerald-500" : (overall.winRate ?? 0) >= 50 ? "text-amber-500" : "text-red-500")}>
            {overall.winRate !== null ? `${overall.winRate}%` : "—"}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Expectancy</p>
          <p className={cn("text-lg font-bold", (overall.expectancy ?? 0) > 0 ? "text-emerald-500" : "text-red-500")}>
            {overall.expectancy !== null ? `$${overall.expectancy}` : "—"}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Total P&L</p>
          <p className={cn("text-lg font-bold", overall.totalPnl >= 0 ? "text-emerald-500" : "text-red-500")}>
            {overall.totalPnl >= 0 ? "+" : ""}${overall.totalPnl.toFixed(0)}
          </p>
        </div>
      </div>

      {/* By instrument */}
      {byInstrument.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">By Instrument</p>
          <div className="space-y-2">
            {byInstrument.slice(0, 6).map((b) => (
              <div key={b.key} className="flex items-center gap-2">
                <span className="text-xs font-mono font-medium w-16 shrink-0">{b.key}</span>
                <div className="flex-1 space-y-0.5">
                  <StatBar value={b.trades} max={maxTrades} color="bg-primary/60" />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums w-12 text-right">{b.trades} trades</span>
                  <WinRateBadge rate={b.winRate} />
                  <span className={cn("tabular-nums w-14 text-right font-medium", b.totalPnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {b.totalPnl >= 0 ? "+" : ""}${b.totalPnl.toFixed(0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By session */}
      {bySession.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">By Session</p>
          <div className="grid grid-cols-2 gap-2">
            {bySession.map((s) => (
              <div key={s.key} className="flex items-center justify-between rounded-md bg-muted/30 px-2.5 py-2">
                <div>
                  <p className="text-xs font-medium">{SESSION_LABELS[s.key] ?? s.key}</p>
                  <p className="text-[10px] text-muted-foreground">{s.trades} trades</p>
                </div>
                <div className="text-right">
                  <WinRateBadge rate={s.winRate} />
                  <p className={cn("text-[10px]", s.totalPnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {s.totalPnl >= 0 ? "+" : ""}${s.totalPnl.toFixed(0)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By day of week */}
      {byDOW.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">By Day of Week</p>
          <div className="flex gap-1.5 flex-wrap">
            {byDOW.map((d) => (
              <div key={d.key} className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md bg-muted/30 min-w-[44px]">
                <span className="text-[10px] font-medium text-muted-foreground">{d.label}</span>
                <WinRateBadge rate={d.winRate} />
                <span className="text-[9px] text-muted-foreground">{d.trades}t</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-right">Last {data.windowDays} days</p>
    </div>
  );
}
