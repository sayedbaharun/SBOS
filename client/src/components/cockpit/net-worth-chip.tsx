import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { useLocation } from "wouter";

export function NetWorthChip() {
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery({
    queryKey: ["net-worth"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/finance/net-worth");
      return res.json();
    },
  });

  const total = data?.total || data?.netWorth || 0;
  const trend = data?.trend || data?.change || 0;
  const trendUp = trend >= 0;

  const formatted = new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0,
  }).format(total);

  return (
    <Card
      className="cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={() => navigate("/finance")}
    >
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Net Worth</span>
        </div>
        {isLoading ? (
          <Skeleton className="h-6 w-28" />
        ) : total === 0 ? (
          <span className="text-sm text-muted-foreground">No accounts</span>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{formatted}</span>
            {trend !== 0 && (
              trendUp
                ? <TrendingUp className="h-4 w-4 text-green-500" />
                : <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
