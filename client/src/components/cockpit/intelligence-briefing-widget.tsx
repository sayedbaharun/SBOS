import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, ChevronDown, ChevronUp, Clock } from "lucide-react";

export function IntelligenceBriefingWidget() {
  const [expanded, setExpanded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["intelligence-daily"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/intelligence/daily");
      return res.json();
    },
  });

  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const beforeSynthesis = hour < 8 || (hour === 8 && minute < 45);

  const synthesis = data?.synthesis || data?.content || data?.body || null;
  const timestamp = data?.createdAt || data?.timestamp || null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Intelligence Briefing
          </CardTitle>
          {timestamp && (
            <span className="text-[10px] text-muted-foreground">
              {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : !synthesis && beforeSynthesis ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Clock className="h-4 w-4" />
            <span>Synthesis runs at 8:45am</span>
          </div>
        ) : !synthesis ? (
          <p className="text-sm text-muted-foreground py-2">No synthesis available today</p>
        ) : (
          <div>
            <div className={expanded ? "" : "line-clamp-4"}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{synthesis}</p>
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
            >
              {expanded ? (
                <>Show less <ChevronUp className="h-3 w-3" /></>
              ) : (
                <>Read more <ChevronDown className="h-3 w-3" /></>
              )}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
