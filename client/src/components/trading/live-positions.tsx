import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { TrendingUp, TrendingDown, RefreshCw, Wifi, WifiOff, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MT5Position {
  ticket: number;
  symbol: string;
  type: "buy" | "sell";
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  commission: number;
  openTime: string;
  comment: string;
}

interface MT5AccountInfo {
  login: number;
  name: string;
  server: string;
  currency: string;
  leverage: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  profit: number;
}

interface PositionsData {
  positions: MT5Position[];
  accountInfo: MT5AccountInfo | null;
  pushedAt: string | null;
  stale: boolean;
}

function ProfitBadge({ profit, currency }: { profit: number; currency: string }) {
  const isPos = profit >= 0;
  return (
    <span className={cn(
      "text-sm font-bold tabular-nums",
      isPos ? "text-emerald-500" : "text-red-500"
    )}>
      {isPos ? "+" : ""}{profit.toFixed(2)} {currency}
    </span>
  );
}

export default function LivePositions() {
  const { data, isLoading, refetch, isFetching } = useQuery<PositionsData>({
    queryKey: ["/api/trading/positions"],
    queryFn: async () => {
      const res = await fetch("/api/trading/positions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const currency = data?.accountInfo?.currency ?? "USD";
  const totalProfit = data?.positions?.reduce((s, p) => s + p.profit, 0) ?? 0;

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="h-16 bg-muted rounded" />
        <div className="h-16 bg-muted rounded" />
      </div>
    );
  }

  // No data yet — EA not connected
  if (!data?.pushedAt) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <WifiOff className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">EA not connected</p>
        <p className="text-xs text-muted-foreground/70 max-w-[200px]">
          Install the SB-OS EA in MT5 to see live positions here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Account strip */}
      {data.accountInfo && (
        <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/50 text-xs">
          <div>
            <p className="text-muted-foreground">Balance</p>
            <p className="font-semibold tabular-nums">{data.accountInfo.balance.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Equity</p>
            <p className="font-semibold tabular-nums">{data.accountInfo.equity.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Margin Lvl</p>
            <p className={cn("font-semibold tabular-nums",
              data.accountInfo.marginLevel < 150 ? "text-red-500"
              : data.accountInfo.marginLevel < 300 ? "text-amber-500"
              : "text-emerald-500"
            )}>
              {data.accountInfo.marginLevel.toFixed(0)}%
            </p>
          </div>
        </div>
      )}

      {/* Connection status + last push */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.stale
            ? <AlertCircle className="h-3 w-3 text-amber-500" />
            : <Wifi className="h-3 w-3 text-emerald-500" />}
          {data.stale ? "Stale — EA may be offline" : "Live"}
          {data.pushedAt && (
            <span>· {format(parseISO(data.pushedAt as string), "HH:mm:ss")}</span>
          )}
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        </button>
      </div>

      {/* Open positions */}
      {data.positions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-3">No open positions</p>
      ) : (
        <div className="space-y-2">
          {/* Total P&L */}
          {data.positions.length > 1 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Total open P&L</span>
              <ProfitBadge profit={totalProfit} currency={currency} />
            </div>
          )}

          {data.positions.map((pos) => {
            const isLong = pos.type === "buy";
            const pips = isLong
              ? (pos.currentPrice - pos.openPrice)
              : (pos.openPrice - pos.currentPrice);
            const riskPips = isLong
              ? (pos.openPrice - pos.sl)
              : (pos.sl - pos.openPrice);
            const r = riskPips > 0 ? pips / riskPips : null;

            return (
              <div key={pos.ticket} className={cn(
                "border rounded-lg p-2.5 space-y-1.5",
                pos.profit >= 0 ? "border-emerald-200/60 dark:border-emerald-900/60 bg-emerald-500/5"
                  : "border-red-200/60 dark:border-red-900/60 bg-red-500/5"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {isLong
                      ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                      : <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
                    <span className="font-semibold text-sm">{pos.symbol}</span>
                    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase",
                      isLong ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                             : "bg-red-500/15 text-red-600 dark:text-red-400"
                    )}>
                      {pos.type}
                    </span>
                    <span className="text-xs text-muted-foreground">{pos.volume} lot{pos.volume !== 1 ? "s" : ""}</span>
                  </div>
                  <ProfitBadge profit={pos.profit} currency={currency} />
                </div>

                <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                  <div>
                    <span className="block">Entry</span>
                    <span className="font-mono font-medium text-foreground">{pos.openPrice}</span>
                  </div>
                  <div>
                    <span className="block">Current</span>
                    <span className="font-mono font-medium text-foreground">{pos.currentPrice}</span>
                  </div>
                  <div>
                    <span className="block">R</span>
                    <span className={cn("font-semibold", r !== null ? (r >= 1 ? "text-emerald-500" : r >= 0 ? "text-amber-500" : "text-red-500") : "text-muted-foreground")}>
                      {r !== null ? `${r >= 0 ? "+" : ""}${r.toFixed(2)}R` : "—"}
                    </span>
                  </div>
                  {pos.sl > 0 && (
                    <div>
                      <span className="block">SL</span>
                      <span className="font-mono text-red-500">{pos.sl}</span>
                    </div>
                  )}
                  {pos.tp > 0 && (
                    <div>
                      <span className="block">TP</span>
                      <span className="font-mono text-emerald-500">{pos.tp}</span>
                    </div>
                  )}
                  {pos.comment && (
                    <div className="col-span-3">
                      <span className="text-muted-foreground/70">{pos.comment}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
