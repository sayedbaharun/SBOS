import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, ChevronRight, Coins, Activity } from "lucide-react";
import { useLocation } from "wouter";

export function AgentPulseWidget() {
  const [, navigate] = useLocation();

  const { data: running, isLoading: isLoadingRunning } = useQuery({
    queryKey: ["agents-running"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/agents/admin/running");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: tokenUsage, isLoading: isLoadingTokens } = useQuery({
    queryKey: ["agents-token-usage"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/agents/token-usage");
      return res.json();
    },
  });

  const { data: queueStats } = useQuery({
    queryKey: ["agents-queue-stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/agents/admin/queue-stats");
      return res.json();
    },
  });

  const runningCount = Array.isArray(running) ? running.length : running?.count || 0;
  const isLoading = isLoadingRunning || isLoadingTokens;

  // Calculate 7-day cost from token usage
  const totalCost = tokenUsage?.totalCost || tokenUsage?.cost7d || 0;
  const costDisplay = typeof totalCost === "number" ? `$${totalCost.toFixed(2)}` : "$0.00";

  // Queue health
  const deadLetters = queueStats?.deadLetters || queueStats?.dead_letters || 0;
  const queueHealthy = deadLetters === 0;

  return (
    <Card
      className="cursor-pointer hover:bg-muted/30 transition-colors"
      onClick={() => navigate("/live-tasks")}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Agent Pulse
          </CardTitle>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {runningCount > 0 ? (
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                ) : (
                  <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/30" />
                )}
                <span className="text-2xl font-bold">{runningCount}</span>
                <span className="text-sm text-muted-foreground">running</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Coins className="h-3 w-3" />
                <span>7d: {costDisplay}</span>
              </div>
              <div className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                <span className={queueHealthy ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                  Queue {queueHealthy ? "healthy" : `${deadLetters} failed`}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
