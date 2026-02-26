import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Check,
  X,
  RotateCcw,
  Loader2,
  FileText,
  Lightbulb,
  ListChecks,
  Code,
  Filter,
  Clock,
  Bot,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Deliverable {
  id: string;
  title: string;
  description: string | null;
  status: string;
  deliverableType: string;
  result: Record<string, any>;
  reviewFeedback: string | null;
  promotedTo: Array<{ type: string; id: string }> | null;
  assignedBy: string;
  createdAt: string;
  completedAt: string | null;
  agentName: string;
  agentSlug: string;
}

interface ReviewStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

const typeIcons: Record<string, typeof FileText> = {
  document: FileText,
  recommendation: Lightbulb,
  action_items: ListChecks,
  code: Code,
};

const typeColors: Record<string, string> = {
  document: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  recommendation: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  action_items: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  code: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const statusColors: Record<string, string> = {
  needs_review: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  pending: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

const statusLabels: Record<string, string> = {
  needs_review: "Pending Review",
  completed: "Approved",
  failed: "Rejected",
  pending: "Changes Requested",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function DeliverableContent({ result }: { result: Record<string, any> }) {
  if (!result) return null;

  switch (result.type) {
    case "document":
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {result.docType && (
            <p className="text-xs text-muted-foreground mb-2">
              Type: {result.docType} {result.domain && `| Domain: ${result.domain}`}
            </p>
          )}
          <div className="whitespace-pre-wrap text-sm">{result.body}</div>
        </div>
      );

    case "recommendation":
      return (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium mb-1">Summary</p>
            <p className="text-sm text-muted-foreground">{result.summary}</p>
          </div>
          <div>
            <p className="text-sm font-medium mb-1">Rationale</p>
            <p className="text-sm text-muted-foreground">{result.rationale}</p>
          </div>
          {result.suggestedAction && result.suggestedAction !== "no_action" && (
            <div>
              <Badge variant="outline" className="text-xs">
                Suggested: {result.suggestedAction.replace("_", " ")}
              </Badge>
            </div>
          )}
        </div>
      );

    case "action_items":
      return (
        <div className="space-y-2">
          {result.summary && (
            <p className="text-sm text-muted-foreground mb-3">{result.summary}</p>
          )}
          <div className="space-y-1.5">
            {(result.items || []).map((item: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm p-2 rounded bg-muted/50">
                <span className="text-muted-foreground font-mono text-xs mt-0.5">{i + 1}.</span>
                <div className="flex-1">
                  <span className="font-medium">{item.title}</span>
                  {item.notes && (
                    <p className="text-muted-foreground text-xs mt-0.5">{item.notes}</p>
                  )}
                </div>
                {item.priority && (
                  <Badge variant="outline" className="text-xs shrink-0">{item.priority}</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      );

    case "code":
      return (
        <div className="space-y-2">
          {result.description && (
            <p className="text-sm text-muted-foreground">{result.description}</p>
          )}
          <pre className="bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm overflow-x-auto">
            <code>{result.code}</code>
          </pre>
          {result.language && (
            <Badge variant="outline" className="text-xs">{result.language}</Badge>
          )}
        </div>
      );

    default:
      return (
        <pre className="text-xs overflow-x-auto bg-muted p-3 rounded">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
}

export default function ReviewQueue() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("needs_review");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedbackDialog, setFeedbackDialog] = useState<{
    id: string;
    action: "reject" | "request-changes";
  } | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  const { data: stats } = useQuery<ReviewStats>({
    queryKey: ["review-stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/review/stats");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: deliverables = [], isLoading } = useQuery<Deliverable[]>({
    queryKey: ["review-queue", statusFilter, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await apiRequest("GET", `/api/review?${params.toString()}`);
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/review/${id}/approve`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["review-stats"] });
      const created = (data.promotedTo || [])
        .map((p: any) => `${p.type} #${p.id}`)
        .join(", ");
      toast({
        title: "Deliverable approved",
        description: created ? `Created: ${created}` : "Approved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve deliverable.",
        variant: "destructive",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, feedback }: { id: string; feedback: string }) => {
      const res = await apiRequest("POST", `/api/review/${id}/reject`, { feedback });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["review-stats"] });
      setFeedbackDialog(null);
      setFeedbackText("");
      toast({ title: "Deliverable rejected" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reject deliverable.",
        variant: "destructive",
      });
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: async ({ id, feedback }: { id: string; feedback: string }) => {
      const res = await apiRequest("POST", `/api/review/${id}/request-changes`, { feedback });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["review-stats"] });
      setFeedbackDialog(null);
      setFeedbackText("");
      toast({
        title: "Changes requested",
        description: "Feedback sent back to the agent.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to request changes.",
        variant: "destructive",
      });
    },
  });

  const handleFeedbackSubmit = () => {
    if (!feedbackDialog || !feedbackText.trim()) return;

    if (feedbackDialog.action === "reject") {
      rejectMutation.mutate({ id: feedbackDialog.id, feedback: feedbackText });
    } else {
      requestChangesMutation.mutate({ id: feedbackDialog.id, feedback: feedbackText });
    }
  };

  const pendingCount = stats?.pending || 0;

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" />
            Review Queue
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review agent deliverables before they go live.
            {pendingCount > 0 && ` ${pendingCount} pending.`}
          </p>
        </div>
        {stats && (
          <div className="hidden sm:flex gap-3 text-sm">
            <span className="text-amber-600 font-medium">{stats.pending} pending</span>
            <span className="text-green-600">{stats.approved} approved</span>
            <span className="text-red-600">{stats.rejected} rejected</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="needs_review">Pending Review</SelectItem>
            <SelectItem value="completed">Approved</SelectItem>
            <SelectItem value="failed">Rejected</SelectItem>
            <SelectItem value="pending">Changes Requested</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="document">Document</SelectItem>
            <SelectItem value="recommendation">Recommendation</SelectItem>
            <SelectItem value="action_items">Action Items</SelectItem>
            <SelectItem value="code">Code</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && deliverables.length === 0 && (
        <div className="text-center py-20">
          <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-1">No deliverables</h3>
          <p className="text-muted-foreground text-sm">
            {statusFilter === "needs_review"
              ? "Nothing pending review. Agents will submit work here."
              : "No deliverables match the current filters."}
          </p>
        </div>
      )}

      {/* Deliverable cards */}
      <div className="space-y-3">
        {deliverables.map((d) => {
          const isExpanded = expandedId === d.id;
          const TypeIcon = typeIcons[d.deliverableType] || FileText;

          return (
            <Card key={d.id} className="overflow-hidden">
              <CardContent className="p-4">
                {/* Header row */}
                <div
                  className="flex items-start gap-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : d.id)}
                >
                  <TypeIcon className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-sm truncate">{d.title}</h3>
                      <Badge className={`text-xs ${typeColors[d.deliverableType] || ""}`}>
                        {d.deliverableType.replace("_", " ")}
                      </Badge>
                      <Badge className={`text-xs ${statusColors[d.status] || ""}`}>
                        {statusLabels[d.status] || d.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Bot className="h-3 w-3" />
                      <span>{d.agentName}</span>
                      <Clock className="h-3 w-3 ml-1" />
                      <span>{timeAgo(d.createdAt)}</span>
                    </div>
                    {d.description && !isExpanded && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {d.description}
                      </p>
                    )}
                    {d.reviewFeedback && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        Feedback: {d.reviewFeedback}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t">
                    <DeliverableContent result={d.result} />

                    {/* Promoted entities */}
                    {d.promotedTo && d.promotedTo.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <p className="text-xs text-muted-foreground mb-1">Created on approval:</p>
                        <div className="flex gap-2 flex-wrap">
                          {d.promotedTo.map((p, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {p.type} #{p.id}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action buttons — only for pending review items */}
                    {d.status === "needs_review" && (
                      <div className="flex gap-2 mt-4 pt-3 border-t">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            approveMutation.mutate(d.id);
                          }}
                          disabled={approveMutation.isPending}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          {approveMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <Check className="h-3 w-3 mr-1" />
                          )}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFeedbackDialog({ id: d.id, action: "request-changes" });
                          }}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Request Changes
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFeedbackDialog({ id: d.id, action: "reject" });
                          }}
                        >
                          <X className="h-3 w-3 mr-1" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Feedback dialog */}
      <Dialog
        open={!!feedbackDialog}
        onOpenChange={(open) => {
          if (!open) {
            setFeedbackDialog(null);
            setFeedbackText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {feedbackDialog?.action === "reject" ? "Reject Deliverable" : "Request Changes"}
            </DialogTitle>
            <DialogDescription>
              {feedbackDialog?.action === "reject"
                ? "This deliverable will be rejected. Provide a reason."
                : "The agent will see your feedback and can resubmit."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Your feedback..."
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setFeedbackDialog(null);
                setFeedbackText("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleFeedbackSubmit}
              disabled={
                !feedbackText.trim() ||
                rejectMutation.isPending ||
                requestChangesMutation.isPending
              }
              variant={feedbackDialog?.action === "reject" ? "destructive" : "default"}
            >
              {(rejectMutation.isPending || requestChangesMutation.isPending) && (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              )}
              {feedbackDialog?.action === "reject" ? "Reject" : "Send Feedback"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
