import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Quote {
  symbol: string;
  label: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  sparkline: number[];
}

interface SnapshotData {
  quotes: Quote[];
  fetchedAt: string | null;
  error?: string;
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 48, h = 20;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  const isUp = data[data.length - 1] >= data[0];
  return (
    <svg width={w} height={h} className="opacity-70">
      <polyline points={pts} fill="none" stroke={isUp ? "#22c55e" : "#ef4444"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MarketSnapshot() {
  const { data, isLoading, refetch, isFetching } = useQuery<SnapshotData>({
    queryKey: ["/api/trading/market-snapshot"],
    queryFn: async () => {
      const res = await fetch("/api/trading/market-snapshot", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 90_000, // auto-refresh every 90s
  });

  return (
    <div className="flex items-center gap-1 justify-between w-full">
      <div className="flex items-center gap-4 overflow-x-auto scrollbar-none pb-0.5 flex-1">
        {isLoading
          ? Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-0.5 min-w-[72px] animate-pulse">
                <div className="h-3 w-10 bg-muted rounded" />
                <div className="h-4 w-16 bg-muted rounded" />
              </div>
            ))
          : (data?.quotes ?? []).map((q) => {
              const isUp = (q.changePct ?? 0) > 0;
              const isDown = (q.changePct ?? 0) < 0;
              return (
                <div key={q.label} className="flex items-center gap-2 min-w-fit shrink-0">
                  <div className="flex flex-col gap-px">
                    <span className="text-[10px] font-semibold text-muted-foreground leading-none tracking-wider uppercase">{q.label}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold tabular-nums">
                        {q.price != null ? q.price.toLocaleString("en-US", { maximumFractionDigits: q.label === "BTC" ? 0 : q.label === "DXY" || q.label === "10Y" ? 3 : 2 }) : "—"}
                      </span>
                      {q.changePct != null && (
                        <span className={cn("text-[10px] font-medium tabular-nums flex items-center gap-0.5", isUp ? "text-emerald-500" : isDown ? "text-red-500" : "text-muted-foreground")}>
                          {isUp ? <TrendingUp className="h-2.5 w-2.5" /> : isDown ? <TrendingDown className="h-2.5 w-2.5" /> : <Minus className="h-2.5 w-2.5" />}
                          {isUp ? "+" : ""}{q.changePct.toFixed(2)}%
                        </span>
                      )}
                    </div>
                  </div>
                  {q.sparkline.length > 1 && <Sparkline data={q.sparkline} />}
                  <div className="w-px h-6 bg-border/60 last:hidden" />
                </div>
              );
            })}
        {data?.error && <span className="text-xs text-muted-foreground">Market data unavailable</span>}
      </div>
      <button
        onClick={() => refetch()}
        disabled={isFetching}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2"
        title="Refresh market data"
      >
        <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
      </button>
    </div>
  );
}
