import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Mail, Inbox } from "lucide-react";

export function EmailTriageWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["email-triage"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/intelligence/email/triage");
      return res.json();
    },
  });

  const emails = Array.isArray(data) ? data : data?.emails || [];

  const urgent = emails.filter((e: any) => e.classification === "urgent" || e.priority === "urgent");
  const actionNeeded = emails.filter((e: any) => e.classification === "action_needed" || e.priority === "action_needed");
  const informational = emails.filter((e: any) => e.classification === "informational" || e.priority === "informational" || e.priority === "low");

  const topItems = [...urgent, ...actionNeeded].slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Email Triage
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : emails.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Inbox className="h-4 w-4" />
            <span>No triaged emails yet today</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {urgent.length > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {urgent.length} urgent
                </Badge>
              )}
              {actionNeeded.length > 0 && (
                <Badge className="text-xs bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20">
                  {actionNeeded.length} action needed
                </Badge>
              )}
              {informational.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {informational.length} info
                </Badge>
              )}
            </div>
            {topItems.length > 0 && (
              <div className="space-y-1">
                {topItems.map((email: any, i: number) => (
                  <div key={email.id || i} className="text-xs text-muted-foreground truncate">
                    {email.subject || email.title || "Untitled email"}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
