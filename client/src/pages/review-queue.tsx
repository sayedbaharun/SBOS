import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ClipboardCheck,
  Check,
  X,
  Pencil,
  Loader2,
  FileText,
  Lightbulb,
  ListChecks,
  Code,
  Clock,
  Bot,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  MessageSquare,
  Film,
  Layers,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useIsMobile } from "@/hooks/use-mobile";
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
  driveWebViewLink: string | null;
  vercelPreviewUrl: string | null;
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
  social_post: MessageSquare,
  video_script: Film,
  carousel: Layers,
};

const typeColors: Record<string, string> = {
  document: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  recommendation: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  action_items: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  code: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  social_post: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  video_script: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  carousel: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
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

    case "social_post":
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {result.platform && <Badge variant="outline" className="text-xs">{result.platform}</Badge>}
            {result.contentType && <Badge variant="outline" className="text-xs">{result.contentType}</Badge>}
            {result.postingTime && (
              <span className="text-xs text-muted-foreground">Post at: {result.postingTime}</span>
            )}
          </div>
          <div className="whitespace-pre-wrap text-sm bg-muted/50 p-3 rounded">{result.copy}</div>
          {result.visualDirection && (
            <div>
              <p className="text-xs font-medium mb-1">Visual Direction</p>
              <p className="text-sm text-muted-foreground">{result.visualDirection}</p>
            </div>
          )}
          {result.hashtags?.length > 0 && (
            <p className="text-sm text-blue-600 dark:text-blue-400">{result.hashtags.join(" ")}</p>
          )}
        </div>
      );

    case "video_script":
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {result.format && <Badge variant="outline" className="text-xs capitalize">{result.format}</Badge>}
            {result.platform && <Badge variant="outline" className="text-xs">{result.platform}</Badge>}
            {result.duration && <span className="text-xs text-muted-foreground">{result.duration}</span>}
            {result.wordCount && <span className="text-xs text-muted-foreground">{result.wordCount} words</span>}
          </div>
          {result.hookLine && (
            <div className="bg-indigo-50 dark:bg-indigo-950/30 p-3 rounded border-l-4 border-indigo-500">
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mb-1">Hook</p>
              <p className="text-sm font-medium">{result.hookLine}</p>
            </div>
          )}
          <div className="whitespace-pre-wrap text-sm bg-muted/50 p-3 rounded">{result.script}</div>
          {result.sceneDirections?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Scene Directions</p>
              <div className="space-y-1">
                {result.sceneDirections.map((d: string, i: number) => (
                  <p key={i} className="text-sm text-muted-foreground italic">[{i + 1}] {d}</p>
                ))}
              </div>
            </div>
          )}
          {result.onScreenText?.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">On-Screen Text</p>
              <div className="flex gap-2 flex-wrap">
                {result.onScreenText.map((t: string, i: number) => (
                  <Badge key={i} variant="secondary" className="text-xs">{t}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      );

    case "carousel":
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {result.platform && <Badge variant="outline" className="text-xs">{result.platform}</Badge>}
            <span className="text-xs text-muted-foreground">{(result.slides || []).length} slides</span>
          </div>
          <div className="grid gap-2">
            {(result.slides || []).map((slide: any, i: number) => (
              <div key={i} className="bg-muted/50 p-3 rounded border-l-4 border-teal-500">
                <p className="text-xs text-muted-foreground mb-1">Slide {i + 1}</p>
                <p className="text-sm font-medium">{slide.headline}</p>
                <p className="text-sm text-muted-foreground mt-1">{slide.body}</p>
              </div>
            ))}
          </div>
          {result.ctaSlide && (
            <div className="bg-teal-50 dark:bg-teal-950/30 p-3 rounded">
              <p className="text-xs font-medium text-teal-600 dark:text-teal-400 mb-1">CTA Slide</p>
              <p className="text-sm">{result.ctaSlide}</p>
            </div>
          )}
          {result.hashtags?.length > 0 && (
            <p className="text-sm text-blue-600 dark:text-blue-400">{result.hashtags.join(" ")}</p>
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

function DeliverableCard({
  d,
  isExpanded,
  onToggle,
  showActions,
  onApprove,
  onAmend,
  onReject,
  approving,
  isMobile,
  onInlineFeedback,
  inlineFeedbackPending,
}: {
  d: Deliverable;
  isExpanded: boolean;
  onToggle: () => void;
  showActions: boolean;
  onApprove?: (id: string) => void;
  onAmend?: (id: string) => void;
  onReject?: (id: string) => void;
  approving?: boolean;
  isMobile?: boolean;
  onInlineFeedback?: (id: string, action: "amend" | "reject", feedback: string) => void;
  inlineFeedbackPending?: boolean;
}) {
  const TypeIcon = typeIcons[d.deliverableType] || FileText;
  const [inlineAction, setInlineAction] = useState<"amend" | "reject" | null>(null);
  const [inlineText, setInlineText] = useState("");

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        {/* Header row */}
        <div
          className="flex items-start gap-3 cursor-pointer"
          onClick={onToggle}
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
              {d.result?.verificationStatus === "verified" && (
                <span className="flex items-center gap-0.5 text-xs text-green-600 dark:text-green-400">
                  <ShieldCheck className="h-3 w-3" />
                  Verified
                </span>
              )}
              {d.result?.verificationStatus === "flagged" && (
                <span
                  className="flex items-center gap-0.5 text-xs text-amber-600 dark:text-amber-400 cursor-help"
                  title={d.result?.verificationNotes || "Flagged by verification gate"}
                >
                  <ShieldAlert className="h-3 w-3" />
                  Needs review
                </span>
              )}
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

            {/* View in Drive / Preview Site link */}
            {(d.vercelPreviewUrl || d.driveWebViewLink) && (
              <div className="mt-3 pt-3 border-t">
                <a
                  href={d.vercelPreviewUrl || d.driveWebViewLink || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {d.vercelPreviewUrl ? (
                    <>
                      <Globe className="h-4 w-4" />
                      Preview Site
                    </>
                  ) : (
                    <>
                      <ExternalLink className="h-4 w-4" />
                      View in Drive
                    </>
                  )}
                </a>
              </div>
            )}

            {/* Action buttons — only for pending review items */}
            {showActions && (
              <div className="mt-4 pt-3 border-t">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onApprove?.(d.id);
                    }}
                    disabled={approving}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {approving ? (
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
                      if (isMobile) {
                        setInlineAction(inlineAction === "amend" ? null : "amend");
                        setInlineText("");
                      } else {
                        onAmend?.(d.id);
                      }
                    }}
                  >
                    <Pencil className="h-3 w-3 mr-1" />
                    Amend
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isMobile) {
                        setInlineAction(inlineAction === "reject" ? null : "reject");
                        setInlineText("");
                      } else {
                        onReject?.(d.id);
                      }
                    }}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Reject
                  </Button>
                </div>

                {/* Inline feedback on mobile */}
                {isMobile && inlineAction && (
                  <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <Textarea
                      value={inlineText}
                      onChange={(e) => setInlineText(e.target.value)}
                      placeholder={
                        inlineAction === "reject"
                          ? "Reason for rejection..."
                          : "What needs to change?"
                      }
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={inlineAction === "reject" ? "destructive" : "default"}
                        disabled={!inlineText.trim() || inlineFeedbackPending}
                        onClick={() => {
                          onInlineFeedback?.(d.id, inlineAction, inlineText);
                          setInlineAction(null);
                          setInlineText("");
                        }}
                      >
                        {inlineFeedbackPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        {inlineAction === "reject" ? "Reject" : "Send Amendments"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setInlineAction(null);
                          setInlineText("");
                        }}
                      >
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
}

const typeFilterOptions = [
  { value: "all", label: "All Types" },
  { value: "document", label: "Document" },
  { value: "recommendation", label: "Recommendation" },
  { value: "action_items", label: "Action Items" },
  { value: "code", label: "Code" },
  { value: "social_post", label: "Social Post" },
  { value: "video_script", label: "Video Script" },
  { value: "carousel", label: "Carousel" },
];

export default function ReviewQueue() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("needs_review");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [feedbackDialog, setFeedbackDialog] = useState<{
    id: string;
    action: "reject" | "amend";
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
    queryKey: ["review-queue", activeTab, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("status", activeTab);
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

  const amendMutation = useMutation({
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
        title: "Amendments sent",
        description: "The agent will revise and resubmit.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send amendments.",
        variant: "destructive",
      });
    },
  });

  const handleFeedbackSubmit = () => {
    if (!feedbackDialog || !feedbackText.trim()) return;

    if (feedbackDialog.action === "reject") {
      rejectMutation.mutate({ id: feedbackDialog.id, feedback: feedbackText });
    } else {
      amendMutation.mutate({ id: feedbackDialog.id, feedback: feedbackText });
    }
  };

  const handleInlineFeedback = (id: string, action: "amend" | "reject", feedback: string) => {
    if (action === "reject") {
      rejectMutation.mutate({ id, feedback });
    } else {
      amendMutation.mutate({ id, feedback });
    }
  };

  const pendingCount = stats?.pending || 0;

  const emptyMessages: Record<string, string> = {
    needs_review: "Nothing pending review. Agents will submit work here.",
    completed: "No approved deliverables yet.",
    failed: "No rejected deliverables.",
  };

  return (
    <div className="max-w-4xl mx-auto">
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
      </div>

      {/* Status Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center gap-3 mb-4">
          <TabsList>
            <TabsTrigger value="needs_review" className="gap-1.5">
              Pending
              {(stats?.pending || 0) > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {stats?.pending}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed" className="gap-1.5">
              Approved
              {(stats?.approved || 0) > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {stats?.approved}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="failed" className="gap-1.5">
              Rejected
              {(stats?.rejected || 0) > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {stats?.rejected}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {isMobile ? (
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {typeFilterOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTypeFilter(opt.value)}
                  className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    typeFilter === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {typeFilterOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {["needs_review", "completed", "failed"].map((tab) => (
          <TabsContent key={tab} value={tab}>
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
                  {emptyMessages[tab]}
                </p>
              </div>
            )}

            {/* Deliverable cards */}
            <div className="space-y-3">
              {deliverables.map((d) => (
                <DeliverableCard
                  key={d.id}
                  d={d}
                  isExpanded={expandedId === d.id}
                  onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
                  showActions={d.status === "needs_review"}
                  onApprove={(id) => approveMutation.mutate(id)}
                  onAmend={(id) => setFeedbackDialog({ id, action: "amend" })}
                  onReject={(id) => setFeedbackDialog({ id, action: "reject" })}
                  approving={approveMutation.isPending}
                  isMobile={isMobile}
                  onInlineFeedback={handleInlineFeedback}
                  inlineFeedbackPending={rejectMutation.isPending || amendMutation.isPending}
                />
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>

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
              {feedbackDialog?.action === "reject" ? "Reject Deliverable" : "Amend Deliverable"}
            </DialogTitle>
            <DialogDescription>
              {feedbackDialog?.action === "reject"
                ? "This deliverable will be rejected. Provide a reason."
                : "Describe your amendments. The agent will revise and resubmit."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={
              feedbackDialog?.action === "reject"
                ? "Reason for rejection..."
                : "What needs to change? Be specific..."
            }
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
                amendMutation.isPending
              }
              variant={feedbackDialog?.action === "reject" ? "destructive" : "default"}
            >
              {(rejectMutation.isPending || amendMutation.isPending) && (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              )}
              {feedbackDialog?.action === "reject" ? "Reject" : "Send Amendments"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
