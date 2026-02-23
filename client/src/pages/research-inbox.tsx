import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Inbox,
  Check,
  X,
  MessageSquare,
  Loader2,
  Rocket,
  FileText,
  Zap,
  Filter,
  Clock,
  ExternalLink,
  Bot,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface ResearchSubmission {
  id: string;
  externalAgentId: string;
  title: string;
  summary: string;
  fullContent: string | null;
  category: string;
  confidence: number | null;
  sources: string[] | null;
  tags: string[] | null;
  status: string;
  reviewNote: string | null;
  promotedTo: { type: string; id: string } | null;
  createdAt: string;
  reviewedAt: string | null;
  agentName: string;
  agentSlug: string;
}

const categoryColors: Record<string, string> = {
  venture_idea: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  market_research: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  competitor_analysis: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  technology: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  opportunity: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  general: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

const statusColors: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  needs_more_info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};

function formatCategory(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ResearchInbox() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approveDialog, setApproveDialog] = useState<ResearchSubmission | null>(null);
  const [approveTarget, setApproveTarget] = useState<"venture" | "capture" | "doc">("venture");
  const [reviewNote, setReviewNote] = useState("");
  const [rejectDialog, setRejectDialog] = useState<ResearchSubmission | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const { data: submissions = [], isLoading } = useQuery<ResearchSubmission[]>({
    queryKey: ["research-submissions", statusFilter, categoryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await apiRequest("GET", `/api/research?${params.toString()}`);
      return res.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, promoteTo, notes }: { id: string; promoteTo: string; notes?: string }) => {
      const res = await apiRequest("POST", `/api/research/${id}/approve`, {
        promoteTo,
        notes,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research-submissions"] });
      setApproveDialog(null);
      setReviewNote("");
      toast({ title: "Submission approved", description: "Research has been promoted successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to approve submission.", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const res = await apiRequest("POST", `/api/research/${id}/reject`, { note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research-submissions"] });
      setRejectDialog(null);
      setRejectNote("");
      toast({ title: "Submission rejected" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reject submission.", variant: "destructive" });
    },
  });

  const requestInfoMutation = useMutation({
    mutationFn: async ({ id, note }: { id: string; note?: string }) => {
      const res = await apiRequest("POST", `/api/research/${id}/request-info`, { note });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research-submissions"] });
      toast({ title: "More info requested", description: "Agent will see this on their next check." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to request info.", variant: "destructive" });
    },
  });

  const pendingCount = submissions.filter((s) => s.status === "pending").length;

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="h-6 w-6" />
            Research Inbox
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review findings from external agents. {pendingCount > 0 && `${pendingCount} pending.`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="needs_more_info">Needs Info</SelectItem>
          </SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="venture_idea">Venture Idea</SelectItem>
            <SelectItem value="market_research">Market Research</SelectItem>
            <SelectItem value="competitor_analysis">Competitor Analysis</SelectItem>
            <SelectItem value="technology">Technology</SelectItem>
            <SelectItem value="opportunity">Opportunity</SelectItem>
            <SelectItem value="general">General</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && submissions.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No submissions found</h3>
            <p className="text-muted-foreground text-sm mt-1">
              {statusFilter === "pending"
                ? "All caught up! No pending research to review."
                : "No submissions match your current filters."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Submission cards */}
      <div className="space-y-3">
        {submissions.map((sub) => {
          const isExpanded = expandedId === sub.id;
          return (
            <Card key={sub.id} className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-semibold leading-tight">
                      {sub.title}
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant="outline" className={categoryColors[sub.category] || ""}>
                        {formatCategory(sub.category)}
                      </Badge>
                      <Badge variant="outline" className={statusColors[sub.status] || ""}>
                        {formatCategory(sub.status)}
                      </Badge>
                      {sub.confidence != null && (
                        <span className="text-xs text-muted-foreground">
                          {Math.round(sub.confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    <Bot className="h-3.5 w-3.5" />
                    {sub.agentName}
                    <span className="mx-1">·</span>
                    <Clock className="h-3.5 w-3.5" />
                    {formatTimeAgo(sub.createdAt)}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground line-clamp-2">{sub.summary}</p>

                {/* Tags */}
                {sub.tags && sub.tags.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {(sub.tags as string[]).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Expandable full content */}
                {sub.fullContent && (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                    className="flex items-center gap-1 text-xs text-primary mt-2 hover:underline"
                  >
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {isExpanded ? "Collapse" : "Show full content"}
                  </button>
                )}
                {isExpanded && sub.fullContent && (
                  <div className="mt-3 p-3 bg-muted/50 rounded-md text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {sub.fullContent}
                  </div>
                )}

                {/* Sources */}
                {sub.sources && (sub.sources as string[]).length > 0 && isExpanded && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Sources:</p>
                    <div className="space-y-1">
                      {(sub.sources as string[]).map((src, i) => (
                        <a
                          key={i}
                          href={src}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {src}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review note */}
                {sub.reviewNote && (
                  <div className="mt-2 p-2 bg-muted rounded text-xs">
                    <span className="font-medium">Review note:</span> {sub.reviewNote}
                  </div>
                )}

                {/* Actions (only for actionable statuses) */}
                {(sub.status === "pending" || sub.status === "needs_more_info") && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                    <Button
                      size="sm"
                      onClick={() => {
                        setApproveDialog(sub);
                        setApproveTarget("venture");
                        setReviewNote("");
                      }}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => requestInfoMutation.mutate({ id: sub.id })}
                      disabled={requestInfoMutation.isPending}
                    >
                      <MessageSquare className="h-3.5 w-3.5 mr-1" />
                      Need Info
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setRejectDialog(sub);
                        setRejectNote("");
                      }}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Reject
                    </Button>
                  </div>
                )}

                {/* Promoted to link */}
                {sub.promotedTo && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Promoted to {sub.promotedTo.type} ({sub.promotedTo.id.slice(0, 8)}...)
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Approve Dialog */}
      <Dialog open={!!approveDialog} onOpenChange={(open) => !open && setApproveDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Research</DialogTitle>
            <DialogDescription>
              Choose where to promote "{approveDialog?.title}"
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={approveTarget === "venture" ? "default" : "outline"}
                onClick={() => setApproveTarget("venture")}
                className="flex flex-col items-center gap-1 h-auto py-3"
              >
                <Rocket className="h-5 w-5" />
                <span className="text-xs">Venture</span>
              </Button>
              <Button
                variant={approveTarget === "capture" ? "default" : "outline"}
                onClick={() => setApproveTarget("capture")}
                className="flex flex-col items-center gap-1 h-auto py-3"
              >
                <Zap className="h-5 w-5" />
                <span className="text-xs">Capture</span>
              </Button>
              <Button
                variant={approveTarget === "doc" ? "default" : "outline"}
                onClick={() => setApproveTarget("doc")}
                className="flex flex-col items-center gap-1 h-auto py-3"
              >
                <FileText className="h-5 w-5" />
                <span className="text-xs">Document</span>
              </Button>
            </div>

            <Textarea
              placeholder="Optional review note..."
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (approveDialog) {
                  approveMutation.mutate({
                    id: approveDialog.id,
                    promoteTo: approveTarget,
                    notes: reviewNote || undefined,
                  });
                }
              }}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Approve as {approveTarget}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(open) => !open && setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Research</DialogTitle>
            <DialogDescription>
              Reject "{rejectDialog?.title}"? You can optionally add a note.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            placeholder="Optional reason for rejection..."
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={3}
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (rejectDialog) {
                  rejectMutation.mutate({
                    id: rejectDialog.id,
                    note: rejectNote || undefined,
                  });
                }
              }}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
