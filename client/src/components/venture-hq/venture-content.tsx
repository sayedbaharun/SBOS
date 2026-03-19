import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  MessageSquare,
  Film,
  Layers,
  Clock,
  Bot,
  ChevronDown,
  ChevronUp,
  Check,
  Pencil,
  X,
  Loader2,
  FileText,
  Copy,
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ContentDeliverable {
  id: string;
  title: string;
  description: string | null;
  status: string;
  deliverableType: string;
  result: Record<string, any>;
  reviewFeedback: string | null;
  assignedBy: string;
  createdAt: string;
  agentName: string;
  agentSlug: string;
}

const formatIcons: Record<string, typeof MessageSquare> = {
  social_post: MessageSquare,
  video_script: Film,
  carousel: Layers,
};

const formatColors: Record<string, string> = {
  social_post: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  video_script: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  carousel: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
};

const statusColors: Record<string, string> = {
  needs_review: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const statusLabels: Record<string, string> = {
  needs_review: "Pending",
  completed: "Approved",
  failed: "Rejected",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ContentPreview({ result }: { result: Record<string, any> }) {
  switch (result.type) {
    case "social_post":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {result.platform && <Badge variant="outline" className="text-xs">{result.platform}</Badge>}
            {result.contentType && <Badge variant="outline" className="text-xs">{result.contentType}</Badge>}
          </div>
          <div className="whitespace-pre-wrap text-sm bg-muted/50 p-3 rounded">{result.copy}</div>
          {result.visualDirection && (
            <p className="text-xs text-muted-foreground"><span className="font-medium">Visual:</span> {result.visualDirection}</p>
          )}
          {result.hashtags?.length > 0 && (
            <p className="text-sm text-blue-600 dark:text-blue-400">{result.hashtags.join(" ")}</p>
          )}
        </div>
      );
    case "video_script":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {result.format && <Badge variant="outline" className="text-xs capitalize">{result.format}</Badge>}
            {result.platform && <Badge variant="outline" className="text-xs">{result.platform}</Badge>}
            {result.duration && <span className="text-xs text-muted-foreground">{result.duration}</span>}
          </div>
          {result.hookLine && (
            <div className="bg-indigo-50 dark:bg-indigo-950/30 p-2 rounded border-l-4 border-indigo-500">
              <p className="text-sm font-medium">{result.hookLine}</p>
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm bg-muted/50 p-3 rounded max-h-60 overflow-y-auto">{result.script}</div>
          {result.sceneDirections?.length > 0 && (
            <div className="space-y-1">
              {result.sceneDirections.map((d: string, i: number) => (
                <p key={i} className="text-xs text-muted-foreground italic">[{i + 1}] {d}</p>
              ))}
            </div>
          )}
        </div>
      );
    case "carousel":
      return (
        <div className="space-y-2">
          {result.platform && <Badge variant="outline" className="text-xs">{result.platform}</Badge>}
          <div className="grid gap-2">
            {(result.slides || []).map((slide: any, i: number) => (
              <div key={i} className="bg-muted/50 p-2 rounded border-l-4 border-teal-500">
                <p className="text-xs text-muted-foreground">Slide {i + 1}</p>
                <p className="text-sm font-medium">{slide.headline}</p>
                <p className="text-sm text-muted-foreground">{slide.body}</p>
              </div>
            ))}
          </div>
          {result.ctaSlide && (
            <p className="text-xs"><span className="font-medium">CTA:</span> {result.ctaSlide}</p>
          )}
        </div>
      );
    default:
      return <pre className="text-xs overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>;
  }
}

export default function VentureContent({ ventureId }: { ventureId: string }) {
  const { toast } = useToast();
  const [formatFilter, setFormatFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackAction, setFeedbackAction] = useState<"amend" | "reject" | null>(null);
  const [feedbackText, setFeedbackText] = useState("");

  const { data: content = [], isLoading } = useQuery<ContentDeliverable[]>({
    queryKey: ["venture-content", ventureId, formatFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (formatFilter !== "all") params.set("format", formatFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiRequest("GET", `/api/ventures/${ventureId}/content?${params.toString()}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/review/${id}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["venture-content"] });
      toast({ title: "Content approved" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, feedback }: { id: string; feedback: string }) => {
      const res = await apiRequest("POST", `/api/review/${id}/reject`, { feedback });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["venture-content"] });
      setFeedbackId(null);
      setFeedbackText("");
      toast({ title: "Content rejected" });
    },
  });

  const amendMutation = useMutation({
    mutationFn: async ({ id, feedback }: { id: string; feedback: string }) => {
      const res = await apiRequest("POST", `/api/review/${id}/request-changes`, { feedback });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["venture-content"] });
      setFeedbackId(null);
      setFeedbackText("");
      toast({ title: "Amendments sent" });
    },
  });

  // Stats
  const stats = {
    total: content.length,
    pending: content.filter((c) => c.status === "needs_review").length,
    approved: content.filter((c) => c.status === "completed").length,
    posts: content.filter((c) => c.deliverableType === "social_post").length,
    scripts: content.filter((c) => c.deliverableType === "video_script").length,
    carousels: content.filter((c) => c.deliverableType === "carousel").length,
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { label: "Total", value: stats.total },
          { label: "Pending", value: stats.pending },
          { label: "Approved", value: stats.approved },
          { label: "Posts", value: stats.posts },
          { label: "Scripts", value: stats.scripts },
          { label: "Carousels", value: stats.carousels },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={formatFilter} onValueChange={setFormatFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Formats</SelectItem>
            <SelectItem value="social_post">Posts</SelectItem>
            <SelectItem value="video_script">Scripts</SelectItem>
            <SelectItem value="carousel">Carousels</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="needs_review">Pending</SelectItem>
            <SelectItem value="completed">Approved</SelectItem>
            <SelectItem value="failed">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && content.length === 0 && (
        <div className="text-center py-16">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium mb-1">No content yet</h3>
          <p className="text-muted-foreground text-sm">Agents will produce drafts on schedule.</p>
        </div>
      )}

      {/* Content cards */}
      <div className="space-y-3">
        {content.map((item) => {
          const Icon = formatIcons[item.deliverableType] || FileText;
          const isExpanded = expandedId === item.id;
          const showFeedback = feedbackId === item.id;

          return (
            <Card key={item.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div
                  className="flex items-start gap-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <Icon className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-sm truncate">{item.title}</h3>
                      <Badge className={`text-xs ${formatColors[item.deliverableType] || ""}`}>
                        {item.deliverableType.replace("_", " ")}
                      </Badge>
                      <Badge className={`text-xs ${statusColors[item.status] || ""}`}>
                        {statusLabels[item.status] || item.status}
                      </Badge>
                      {item.result?.platform && (
                        <Badge variant="outline" className="text-xs">{item.result.platform}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Bot className="h-3 w-3" />
                      <span>{item.agentName}</span>
                      <Clock className="h-3 w-3 ml-1" />
                      <span>{timeAgo(item.createdAt)}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t">
                    <ContentPreview result={item.result} />

                    {item.reviewFeedback && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                        Feedback: {item.reviewFeedback}
                      </p>
                    )}

                    {/* Actions for pending items */}
                    {item.status === "needs_review" && (
                      <div className="mt-4 pt-3 border-t">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              approveMutation.mutate(item.id);
                            }}
                            disabled={approveMutation.isPending}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            <Check className="h-3 w-3 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFeedbackId(item.id);
                              setFeedbackAction("amend");
                              setFeedbackText("");
                            }}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Amend
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFeedbackId(item.id);
                              setFeedbackAction("reject");
                              setFeedbackText("");
                            }}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              const text = item.result?.copy || item.result?.script || JSON.stringify(item.result, null, 2);
                              navigator.clipboard.writeText(text);
                              toast({ title: "Copied to clipboard" });
                            }}
                          >
                            <Copy className="h-3 w-3 mr-1" />
                            Copy
                          </Button>
                        </div>

                        {showFeedback && (
                          <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                            <Textarea
                              value={feedbackText}
                              onChange={(e) => setFeedbackText(e.target.value)}
                              placeholder={feedbackAction === "reject" ? "Reason for rejection..." : "What needs to change?"}
                              rows={3}
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant={feedbackAction === "reject" ? "destructive" : "default"}
                                disabled={!feedbackText.trim()}
                                onClick={() => {
                                  if (feedbackAction === "reject") {
                                    rejectMutation.mutate({ id: item.id, feedback: feedbackText });
                                  } else {
                                    amendMutation.mutate({ id: item.id, feedback: feedbackText });
                                  }
                                }}
                              >
                                {feedbackAction === "reject" ? "Reject" : "Send Amendments"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setFeedbackId(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
