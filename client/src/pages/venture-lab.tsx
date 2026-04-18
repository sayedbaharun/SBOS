import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  FlaskConical,
  Plus,
  Search,
  Target,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Brain,
  CheckCircle2,
  XCircle,
  PauseCircle,
  AlertTriangle,
  TrendingUp,
  Rocket,
  FileText,
  Edit3,
  Trash2,
  RefreshCw,
  ExternalLink,
  Clock,
  Zap,
  Wand2,
  Link,
  ClipboardPaste,
} from "lucide-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Types
interface ScoreBreakdown {
  score: number;
  max: number;
  reasoning: string;
}

interface ScoreData {
  rawScore: number;
  confidence: number;
  finalScore: number;
  breakdown: {
    buyerClarityBudget: ScoreBreakdown;
    painIntensityUrgency: ScoreBreakdown;
    distributionFeasibility: ScoreBreakdown;
    revenueModelRealism: ScoreBreakdown;
    competitiveEdge: ScoreBreakdown;
    executionComplexity: ScoreBreakdown;
    regulatoryFriction: ScoreBreakdown;
    aiLeverage: ScoreBreakdown;
  };
  killReasons: string[];
  nextValidationSteps: string[];
}

interface VentureIdea {
  id: string;
  name: string;
  description: string;
  domain: string | null;
  targetCustomer: string | null;
  initialThoughts: string | null;
  status: string;
  researchDocId: string | null;
  researchCompletedAt: string | null;
  researchModel: string | null;
  researchTokensUsed: number | null;
  scoreData: ScoreData | null;
  verdict: "GREEN" | "YELLOW" | "RED" | null;
  scoredAt: string | null;
  approvalDecision: string | null;
  approvalComment: string | null;
  approvedAt: string | null;
  ventureId: string | null;
  compiledAt: string | null;
  compilationData: {
    projectsCreated: number;
    phasesCreated: number;
    tasksCreated: number;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface ResearchDoc {
  id: string;
  title: string;
  body: string;
}

const DOMAIN_OPTIONS = [
  { value: "saas", label: "SaaS / Software" },
  { value: "media", label: "Media / Content" },
  { value: "ecommerce", label: "E-commerce / Retail" },
  { value: "services", label: "Services / Consulting" },
  { value: "marketplace", label: "Marketplace / Platform" },
  { value: "fintech", label: "Fintech / Finance" },
  { value: "healthtech", label: "Healthtech / Wellness" },
  { value: "edtech", label: "Edtech / Education" },
  { value: "realty", label: "Real Estate" },
  { value: "other", label: "Other" },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  idea: { label: "New Idea", color: "bg-slate-500", icon: Target },
  researching: { label: "Researching", color: "bg-blue-500", icon: Search },
  researched: { label: "Researched", color: "bg-indigo-500", icon: FileText },
  scoring: { label: "Scoring", color: "bg-purple-500", icon: Brain },
  scored: { label: "Scored", color: "bg-violet-500", icon: TrendingUp },
  approved: { label: "Approved", color: "bg-green-500", icon: CheckCircle2 },
  prototyped: { label: "Prototyped", color: "bg-teal-500", icon: Link },
  rejected: { label: "Killed", color: "bg-red-500", icon: XCircle },
  parked: { label: "Parked", color: "bg-amber-500", icon: PauseCircle },
  compiling: { label: "Compiling", color: "bg-cyan-500", icon: Zap },
  compiled: { label: "Compiled", color: "bg-emerald-500", icon: Rocket },
  failed: { label: "Failed", color: "bg-red-700", icon: AlertTriangle },
};

const VERDICT_CONFIG = {
  GREEN: { label: "GREEN", color: "bg-green-500 text-white", description: "Full venture pack" },
  YELLOW: { label: "YELLOW", color: "bg-yellow-500 text-black", description: "Pilot pack only" },
  RED: { label: "RED", color: "bg-red-500 text-white", description: "Kill / Archive" },
};

// Components
function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.idea;
  const Icon = config.icon;
  return (
    <Badge className={`${config.color} text-white gap-1`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

function VerdictBadge({ verdict }: { verdict: "GREEN" | "YELLOW" | "RED" }) {
  const config = VERDICT_CONFIG[verdict];
  return (
    <Badge className={`${config.color} text-sm px-3 py-1`}>
      {config.label} - {config.description}
    </Badge>
  );
}

function ScoreDisplay({ scoreData }: { scoreData: ScoreData }) {
  const dimensions = [
    { key: "buyerClarityBudget", label: "Buyer Clarity & Budget" },
    { key: "painIntensityUrgency", label: "Pain Intensity" },
    { key: "distributionFeasibility", label: "Distribution" },
    { key: "revenueModelRealism", label: "Revenue Model" },
    { key: "competitiveEdge", label: "Competitive Edge" },
    { key: "executionComplexity", label: "Execution (inverse)" },
    { key: "regulatoryFriction", label: "Regulatory (inverse)" },
    { key: "aiLeverage", label: "AI Leverage" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-3xl font-bold">{scoreData.finalScore.toFixed(1)}</div>
          <div className="text-sm text-muted-foreground">
            Raw: {scoreData.rawScore} × Confidence: {(scoreData.confidence * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {dimensions.map(({ key, label }) => {
          const data = scoreData.breakdown[key as keyof typeof scoreData.breakdown];
          const percentage = (data.score / data.max) * 100;
          return (
            <div key={key} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{label}</span>
                <span className="text-muted-foreground">
                  {data.score}/{data.max}
                </span>
              </div>
              <Progress value={percentage} className="h-2" />
              <p className="text-xs text-muted-foreground">{data.reasoning}</p>
            </div>
          );
        })}
      </div>

      {scoreData.killReasons.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium text-red-600 mb-2">Kill Reasons</h4>
          <ul className="list-disc list-inside text-sm text-muted-foreground">
            {scoreData.killReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {scoreData.nextValidationSteps.length > 0 && (
        <div className="mt-4">
          <h4 className="font-medium mb-2">Next Validation Steps</h4>
          <ol className="list-decimal list-inside text-sm text-muted-foreground">
            {scoreData.nextValidationSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function CreateIdeaDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    domain: "",
    targetCustomer: "",
    initialThoughts: "",
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await apiRequest("POST", "/api/venture-lab/ideas", data);
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Idea created", description: "Your idea has been captured." });
      setOpen(false);
      setFormData({ name: "", description: "", domain: "", targetCustomer: "", initialThoughts: "" });
      onCreated();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          New Idea
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Capture New Idea</DialogTitle>
          <DialogDescription>
            Describe your business idea. We'll research, score, and help you decide if it's worth pursuing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Idea Name *</Label>
            <Input
              id="name"
              placeholder="e.g., AI-Powered Resume Builder"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="What does it do? What problem does it solve?"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
            />
          </div>

          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {showAdvanced ? "Less details" : "More details (optional)"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Domain</Label>
                  <Select
                    value={formData.domain}
                    onValueChange={(value) => setFormData({ ...formData, domain: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select domain" />
                    </SelectTrigger>
                    <SelectContent>
                      {DOMAIN_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetCustomer">Target Customer</Label>
                  <Input
                    id="targetCustomer"
                    placeholder="e.g., Job seekers"
                    value={formData.targetCustomer}
                    onChange={(e) => setFormData({ ...formData, targetCustomer: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="initialThoughts">Initial Thoughts</Label>
                <Textarea
                  id="initialThoughts"
                  placeholder="Any hypotheses to validate?"
                  value={formData.initialThoughts}
                  onChange={(e) => setFormData({ ...formData, initialThoughts: e.target.value })}
                  rows={2}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createMutation.mutate(formData)}
            disabled={!formData.name || !formData.description || createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Idea"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdeaCard({
  idea,
  onSelect,
  isSelected,
}: {
  idea: VentureIdea;
  onSelect: () => void;
  isSelected: boolean;
}) {
  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${
        isSelected ? "ring-2 ring-primary" : ""
      }`}
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{idea.name}</CardTitle>
            <div className="flex items-center gap-2">
              <StatusBadge status={idea.status} />
              {idea.verdict && <VerdictBadge verdict={idea.verdict} />}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2">{idea.description}</p>
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          {idea.domain && (
            <span>{DOMAIN_OPTIONS.find((d) => d.value === idea.domain)?.label || idea.domain}</span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(idea.createdAt).toLocaleDateString()}
          </span>
          {idea.scoreData && (
            <span className="font-medium text-foreground">
              Score: {idea.scoreData.finalScore.toFixed(1)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function IdeaDetail({
  idea,
  researchDoc,
  onRefresh,
}: {
  idea: VentureIdea;
  researchDoc: ResearchDoc | null;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [editingResearch, setEditingResearch] = useState(false);
  const [researchContent, setResearchContent] = useState(researchDoc?.body || "");
  const [approvalComment, setApprovalComment] = useState("");

  useEffect(() => {
    setResearchContent(researchDoc?.body || "");
  }, [researchDoc]);

  // Research mutation
  const researchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/venture-lab/ideas/${idea.id}/research`);
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Research complete", description: "AI research has been generated." });
      onRefresh();
    },
    onError: (error: any) => {
      toast({ title: "Research failed", description: error.message, variant: "destructive" });
    },
  });

  // Update research mutation
  const updateResearchMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("PATCH", `/api/venture-lab/ideas/${idea.id}/research`, {
        researchContent: content,
      });
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Research updated", description: "Your edits have been saved." });
      setEditingResearch(false);
      onRefresh();
    },
    onError: (error: any) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  // Score mutation
  const scoreMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/venture-lab/ideas/${idea.id}/score`);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Scoring complete",
        description: data.cached ? "Returned cached score (same inputs)." : "Idea has been scored.",
      });
      onRefresh();
    },
    onError: (error: any) => {
      toast({ title: "Scoring failed", description: error.message, variant: "destructive" });
    },
  });

  // Approval mutation
  const approvalMutation = useMutation({
    mutationFn: async (decision: "approved" | "parked" | "killed") => {
      const res = await apiRequest("POST", `/api/venture-lab/ideas/${idea.id}/approve`, {
        decision,
        comment: approvalComment,
      });
      return await res.json();
    },
    onSuccess: (_, decision) => {
      const messages = {
        approved: "Idea approved! Ready for compilation.",
        parked: "Idea parked for later review.",
        killed: "Idea killed and archived.",
      };
      toast({ title: "Decision recorded", description: messages[decision] });
      setApprovalComment("");
      onRefresh();
    },
    onError: (error: any) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    },
  });

  // Compile mutation
  const compileMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/venture-lab/ideas/${idea.id}/compile`);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Venture created!",
        description: `Created ${data.stats.projectsCreated} projects, ${data.stats.phasesCreated} phases, ${data.stats.tasksCreated} tasks.`,
      });
      onRefresh();
    },
    onError: (error: any) => {
      toast({ title: "Compilation failed", description: error.message, variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/venture-lab/ideas/${idea.id}`);
    },
    onSuccess: () => {
      toast({ title: "Idea deleted" });
      onRefresh();
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const isLoading =
    researchMutation.isPending ||
    scoreMutation.isPending ||
    approvalMutation.isPending ||
    compileMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">{idea.name}</h2>
          <p className="text-muted-foreground mt-1">{idea.description}</p>
          <div className="flex items-center gap-2 mt-3">
            <StatusBadge status={idea.status} />
            {idea.verdict && <VerdictBadge verdict={idea.verdict} />}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate()}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {/* Workflow Steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 1: Research */}
          <div className="flex items-center gap-4">
            <div
              className={`h-10 w-10 rounded-full flex items-center justify-center ${
                idea.status === "idea"
                  ? "bg-primary text-primary-foreground"
                  : idea.researchDocId
                  ? "bg-green-500 text-white"
                  : "bg-muted"
              }`}
            >
              {idea.status === "researching" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </div>
            <div className="flex-1">
              <div className="font-medium">1. Research</div>
              <div className="text-sm text-muted-foreground">
                {idea.researchDocId
                  ? `Completed with ${idea.researchModel || "AI"}`
                  : "Run AI-powered market research"}
              </div>
            </div>
            {idea.status === "idea" && (
              <Button onClick={() => researchMutation.mutate()} disabled={isLoading}>
                {researchMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Researching...
                  </>
                ) : (
                  <>
                    <Brain className="mr-2 h-4 w-4" />
                    Run Research
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Step 2: Review & Edit */}
          {idea.researchDocId && (
            <div className="flex items-center gap-4">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center ${
                  idea.status === "researched" ? "bg-primary text-primary-foreground" : "bg-green-500 text-white"
                }`}
              >
                <Edit3 className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-medium">2. Review & Edit</div>
                <div className="text-sm text-muted-foreground">Review research before scoring</div>
              </div>
              {idea.status === "researched" && !editingResearch && (
                <Button variant="outline" onClick={() => setEditingResearch(true)}>
                  Edit Research
                </Button>
              )}
            </div>
          )}

          {/* Step 3: Score */}
          {idea.researchDocId && (
            <div className="flex items-center gap-4">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center ${
                  idea.status === "researched"
                    ? "bg-primary text-primary-foreground"
                    : idea.scoreData
                    ? "bg-green-500 text-white"
                    : "bg-muted"
                }`}
              >
                {idea.status === "scoring" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <TrendingUp className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1">
                <div className="font-medium">3. Score</div>
                <div className="text-sm text-muted-foreground">
                  {idea.scoreData
                    ? `Score: ${idea.scoreData.finalScore.toFixed(1)} (${idea.verdict})`
                    : "AI scores the opportunity"}
                </div>
              </div>
              {idea.status === "researched" && (
                <Button onClick={() => scoreMutation.mutate()} disabled={isLoading}>
                  {scoreMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Scoring...
                    </>
                  ) : (
                    <>
                      <Brain className="mr-2 h-4 w-4" />
                      Score Idea
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* Step 4: Approve */}
          {idea.scoreData && (
            <div className="flex items-center gap-4">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center ${
                  idea.status === "scored"
                    ? "bg-primary text-primary-foreground"
                    : idea.approvalDecision
                    ? "bg-green-500 text-white"
                    : "bg-muted"
                }`}
              >
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-medium">4. Human Approval</div>
                <div className="text-sm text-muted-foreground">
                  {idea.approvalDecision
                    ? `Decision: ${idea.approvalDecision}`
                    : "Make GO/NO-GO decision"}
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Prototype (optional — between Approved and Compile) */}
          {(idea.status === "approved" || idea.status === "prototyped") && (
            <PrototypeStage idea={idea} />
          )}

          {/* Step 6: Compile */}
          {(idea.status === "approved" || idea.status === "prototyped") && (
            <div className="flex items-center gap-4">
              <div
                className={`h-10 w-10 rounded-full flex items-center justify-center ${
                  idea.status === "approved"
                    ? "bg-primary text-primary-foreground"
                    : idea.ventureId
                    ? "bg-green-500 text-white"
                    : "bg-muted"
                }`}
              >
                {idea.status === "compiling" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Rocket className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1">
                <div className="font-medium">5. Compile to Venture</div>
                <div className="text-sm text-muted-foreground">
                  {idea.verdict === "GREEN"
                    ? "Full venture pack with projects & tasks"
                    : "Pilot validation sprint"}
                </div>
              </div>
              <Button onClick={() => compileMutation.mutate()} disabled={isLoading}>
                {compileMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Compiling...
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" />
                    Compile Venture
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Compiled State */}
          {idea.status === "compiled" && idea.ventureId && (
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-full flex items-center justify-center bg-emerald-500 text-white">
                <Rocket className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-medium">Venture Created!</div>
                <div className="text-sm text-muted-foreground">
                  {idea.compilationData &&
                    `${idea.compilationData.projectsCreated} projects, ${idea.compilationData.phasesCreated} phases, ${idea.compilationData.tasksCreated} tasks`}
                </div>
              </div>
              <Button variant="outline" asChild>
                <a href={`/ventures/${idea.ventureId}`}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Venture
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Research Content */}
      {researchDoc && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center justify-between">
              Research
              {idea.status === "researched" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingResearch(!editingResearch)}
                >
                  <Edit3 className="h-4 w-4 mr-1" />
                  {editingResearch ? "Cancel" : "Edit"}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {editingResearch ? (
              <div className="space-y-4">
                <Textarea
                  value={researchContent}
                  onChange={(e) => setResearchContent(e.target.value)}
                  rows={20}
                  className="font-mono text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => updateResearchMutation.mutate(researchContent)}
                    disabled={updateResearchMutation.isPending}
                  >
                    {updateResearchMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                  <Button variant="outline" onClick={() => setEditingResearch(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <pre className="whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg overflow-auto max-h-[400px]">
                  {researchDoc.body}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Score Breakdown */}
      {idea.scoreData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Score Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreDisplay scoreData={idea.scoreData} />
          </CardContent>
        </Card>
      )}

      {/* Approval Panel */}
      {idea.status === "scored" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your Decision</CardTitle>
            <CardDescription>
              {idea.verdict === "RED"
                ? "This idea scored RED. You can park it for later or kill it."
                : "Review the score and make your GO/NO-GO decision."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Comment (optional)</Label>
              <Textarea
                value={approvalComment}
                onChange={(e) => setApprovalComment(e.target.value)}
                placeholder="Add any notes about your decision..."
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              {idea.verdict !== "RED" && (
                <Button
                  onClick={() => approvalMutation.mutate("approved")}
                  disabled={isLoading}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => approvalMutation.mutate("parked")}
                disabled={isLoading}
              >
                <PauseCircle className="mr-2 h-4 w-4" />
                Park
              </Button>
              <Button
                variant="destructive"
                onClick={() => approvalMutation.mutate("killed")}
                disabled={isLoading}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Kill
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Prototype Stage Component
// ============================================================================

function PrototypeStage({ idea }: { idea: VentureIdea }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [prototypeUrl, setProtoUrl] = useState((idea as any).prototypeUrl || "");
  const [prototypePlatform, setProtoPlatform] = useState((idea as any).prototypePlatform || "lovable");
  const [evalText, setEvalText] = useState("");
  const [showEvalInput, setShowEvalInput] = useState(false);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/venture-lab/ideas/${idea.id}/prototype`, { url: prototypeUrl, platform: prototypePlatform }),
    onSuccess: () => toast({ title: "Prototype saved" }),
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const evalMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/venture-lab/ideas/${idea.id}/evaluate`, { rawText: evalText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/venture-lab/ideas"] });
      toast({ title: "Evaluation parsed", description: "Idea updated to Prototyped status." });
      setShowEvalInput(false);
    },
    onError: () => toast({ title: "Parse failed", variant: "destructive" }),
  });

  const PLATFORM_OPTIONS = [
    { value: "lovable", label: "Lovable" },
    { value: "replit", label: "Replit" },
    { value: "v0", label: "v0" },
    { value: "genspark", label: "Genspark" },
    { value: "manus", label: "Manus" },
    { value: "other", label: "Other" },
  ];

  const isPrototyped = idea.status === "prototyped";

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-teal-50/30 dark:bg-teal-900/10 border-teal-200 dark:border-teal-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full flex items-center justify-center bg-teal-500 text-white">
            <Link className="h-4 w-4" />
          </div>
          <div>
            <div className="font-medium text-sm">5. Prototype (Optional)</div>
            <div className="text-xs text-muted-foreground">Build in Lovable/Replit/Genspark, then evaluate</div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLocation(`/venture-lab/build`)}
          className="text-xs"
        >
          <Wand2 className="h-3 w-3 mr-1" />
          Generate Briefs
        </Button>
      </div>

      {/* URL + Platform input */}
      <div className="flex gap-2">
        <Select value={prototypePlatform} onValueChange={setProtoPlatform}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATFORM_OPTIONS.map(p => (
              <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Paste prototype URL..."
          value={prototypeUrl}
          onChange={e => setProtoUrl(e.target.value)}
          className="h-8 text-xs flex-1"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={() => saveMutation.mutate()}
          disabled={!prototypeUrl || saveMutation.isPending}
        >
          {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
      </div>

      {/* Eval paste area */}
      {!showEvalInput && !isPrototyped && (
        <Button
          variant="outline"
          size="sm"
          className="text-xs w-full"
          onClick={() => setShowEvalInput(true)}
        >
          <ClipboardPaste className="h-3 w-3 mr-1" />
          Paste Evaluation Results
        </Button>
      )}

      {showEvalInput && (
        <div className="space-y-2">
          <Textarea
            placeholder="Paste evaluation output from Genspark/Manus here..."
            value={evalText}
            onChange={e => setEvalText(e.target.value)}
            rows={6}
            className="text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="text-xs"
              onClick={() => evalMutation.mutate()}
              disabled={evalText.length < 100 || evalMutation.isPending}
            >
              {evalMutation.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Brain className="mr-1 h-3 w-3" />
              )}
              Parse & Analyse
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowEvalInput(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isPrototyped && (
        <div className="flex items-center gap-2 text-xs text-teal-700 dark:text-teal-300">
          <CheckCircle2 className="h-4 w-4" />
          <span>Evaluation complete — readiness score: {(idea as any).prototypeReadinessScore ?? "–"}/100</span>
        </div>
      )}
    </div>
  );
}

// Main Page Component
export default function VentureLabPage() {
  const { toast } = useToast();
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch ideas list
  const ideasQuery = useQuery({
    queryKey: ["/api/venture-lab/ideas"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/venture-lab/ideas");
      return (await res.json()) as VentureIdea[];
    },
  });

  // Fetch selected idea details
  const ideaDetailQuery = useQuery({
    queryKey: ["/api/venture-lab/ideas", selectedIdeaId],
    queryFn: async () => {
      if (!selectedIdeaId) return null;
      const res = await apiRequest("GET", `/api/venture-lab/ideas/${selectedIdeaId}`);
      return (await res.json()) as { idea: VentureIdea; researchDoc: ResearchDoc | null };
    },
    enabled: !!selectedIdeaId,
  });

  const filteredIdeas = (ideasQuery.data || []).filter((idea) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "active") return !["rejected", "compiled", "parked"].includes(idea.status);
    return idea.status === statusFilter;
  });

  const handleRefresh = () => {
    ideasQuery.refetch();
    if (selectedIdeaId) {
      ideaDetailQuery.refetch();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 flex items-center justify-center">
              <FlaskConical className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Venture Lab</h1>
              <p className="text-sm text-muted-foreground">
                Research, validate, and compile business ideas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <CreateIdeaDialog onCreated={handleRefresh} />
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Ideas List */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Ideas</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="idea">New</SelectItem>
                  <SelectItem value="researched">Researched</SelectItem>
                  <SelectItem value="scored">Scored</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="compiled">Compiled</SelectItem>
                  <SelectItem value="parked">Parked</SelectItem>
                  <SelectItem value="rejected">Killed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {ideasQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filteredIdeas.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <FlaskConical className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No ideas yet.</p>
                  <p className="text-sm">Create your first idea to get started.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredIdeas.map((idea) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    onSelect={() => setSelectedIdeaId(idea.id)}
                    isSelected={selectedIdeaId === idea.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Idea Detail */}
          <div className="lg:col-span-2">
            {selectedIdeaId && ideaDetailQuery.data ? (
              <IdeaDetail
                idea={ideaDetailQuery.data.idea}
                researchDoc={ideaDetailQuery.data.researchDoc}
                onRefresh={handleRefresh}
              />
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-muted-foreground">
                  <Target className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Select an idea to view details</p>
                  <p className="text-sm mt-2">
                    Or create a new idea to start the research process
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
