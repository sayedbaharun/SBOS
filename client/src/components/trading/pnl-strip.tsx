import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

interface PnlPeriod {
  pnl: number;
  trades: number;
  wins?: number;
}

interface PnlData {
  day: PnlPeriod;
  week: PnlPeriod;
  month: PnlPeriod;
  ytd: PnlPeriod;
  equityCurve: { date: string; pnl: number }[];
}

function MiniEquityCurve({ data }: { data: { date: string; pnl: number }[] }) {
  if (data.length < 2) return null;
  const values = data.map((d) => d.pnl);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 80, h = 28;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  const isPositive = values[values.length - 1] >= 0;
  return (
    <svg width={w} height={h} className="opacity-80">
      <polyline points={pts} fill="none" stroke={isPositive ? "#22c55e" : "#ef4444"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PnlCell({ label, pnl, trades, wins }: { label: string; pnl: number; trades: number; wins?: number }) {
  const isPositive = pnl > 0;
  const isNegative = pnl < 0;
  return (
    <div className="flex flex-col gap-0.5 px-4 first:pl-0 border-l first:border-l-0 border-border/60">
      <span className="text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">{label}</span>
      <span className={cn("text-lg font-bold tabular-nums leading-tight", isPositive ? "text-emerald-500" : isNegative ? "text-red-500" : "text-foreground")}>
        {pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}
      </span>
      <span className="text-[10px] text-muted-foreground">
        {trades} trade{trades !== 1 ? "s" : ""}
        {wins !== undefined && trades > 0 ? ` · ${Math.round((wins / trades) * 100)}% W` : ""}
      </span>
    </div>
  );
}

export default function PnlStrip() {
  const { data, isLoading } = useQuery<PnlData>({
    queryKey: ["/api/trading/pnl"],
    queryFn: async () => {
      const res = await fetch("/api/trading/pnl", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-4 animate-pulse">
        {["Day", "Week", "Month", "YTD"].map((l) => (
          <div key={l} className="flex flex-col gap-1 px-4 first:pl-0">
            <div className="h-2.5 w-8 bg-muted rounded" />
            <div className="h-6 w-14 bg-muted rounded" />
            <div className="h-2 w-10 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <PnlCell label="Today" pnl={data.day.pnl} trades={data.day.trades} wins={data.day.wins} />
      <PnlCell label="Week" pnl={data.week.pnl} trades={data.week.trades} wins={data.week.wins} />
      <PnlCell label="Month" pnl={data.month.pnl} trades={data.month.trades} />
      <PnlCell label="YTD" pnl={data.ytd.pnl} trades={data.ytd.trades} />
      {data.equityCurve.length > 1 && (
        <div className="ml-auto flex items-end gap-1">
          <span className="text-[10px] text-muted-foreground">30d curve</span>
          <MiniEquityCurve data={data.equityCurve} />
        </div>
      )}
    </div>
  );
}
