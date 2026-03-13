import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, ChevronRight, FileCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const typeBadgeColors: Record<string, string> = {
  document: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  recommendation: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  action_items: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  code: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  idea_validation: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
};

export function ReviewQueueWidget() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["review-widget"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/review?status=needs_review&limit=3");
      return res.json();
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["review-stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/review/stats");
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/review/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-widget"] });
      queryClient.invalidateQueries({ queryKey: ["review-stats"] });
      toast({ title: "Approved" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/review/${id}/reject`, { feedback: "Rejected from dashboard" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-widget"] });
      queryClient.invalidateQueries({ queryKey: ["review-stats"] });
      toast({ title: "Rejected" });
    },
  });

  const pendingCount = stats?.needs_review || stats?.pending || 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <FileCheck className="h-4 w-4" />
            Review Queue
          </CardTitle>
          {pendingCount > 0 && (
            <Badge variant="destructive" className="text-xs px-2 py-0">
              {pendingCount}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <p className="text-sm text-muted-foreground">All caught up</p>
          </div>
        ) : (
          <>
            {items.map((item: any) => (
              <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{item.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{item.agentName || "Agent"}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${typeBadgeColors[item.deliverableType] || ""}`}>
                      {(item.deliverableType || "").replace("_", " ")}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{item.completedAt ? timeAgo(item.completedAt) : ""}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-500/10"
                    onClick={() => approveMutation.mutate(item.id)}
                    disabled={approveMutation.isPending}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-500/10"
                    onClick={() => rejectMutation.mutate(item.id)}
                    disabled={rejectMutation.isPending}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            {pendingCount > items.length && (
              <button
                onClick={() => navigate("/review")}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1 pt-2"
              >
                View all ({pendingCount}) <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
