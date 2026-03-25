import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot,
  GitBranch,
  Search,
  ChevronRight,
  Clock,
  Wrench,
  Activity,
  ArrowRight,
  LayoutGrid,
  Network,
  FileText,
  Zap,
  ChevronDown,
  RefreshCw,
  User,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  getAgentIdentity,
  ROLE_DOT,
  ROLE_TEXT,
  TIER_LABELS,
  TIER_COLORS,
} from "@/lib/agent-identity";

// ── Types ──────────────────────────────────────────────

interface Agent {
  id: string;
  name: string;
  slug: string;
  role: string;
  parentId: string | null;
  soul: string;
  expertise: string[];
  availableTools: string[];
  actionPermissions: string[];
  canDelegateTo: string[];
  modelTier: string;
  temperature: number;
  schedule: Record<string, string> | null;
  isActive: boolean;
  createdAt: string;
}

interface OrgNode {
  agent: Agent;
  children: OrgNode[];
}

interface DelegationLog {
  id: string;
  title: string;
  status: string;
  assignedBy: string;
  assignedTo: string;
  createdAt: string;
  completedAt: string | null;
  deliverableType: string | null;
}

interface ScheduleJob {
  agentSlug: string;
  jobName: string;
  cronExpression: string;
  lastRun: string | null;
  runCount: number;
  errorCount: number;
}

interface AgentMetric {
  agentId: string;
  slug: string;
  name: string;
  isActive: boolean;
  chatInvocations: number;
  scheduledRuns: number;
  scheduledErrors: number;
  delegationsReceived: number;
  delegationsCompleted: number;
  delegationsFailed: number;
  avgExecutionTimeMs: number | null;
  totalTokens: number;
  totalCostCents: number;
  lastActivity: string | null;
  status: "active" | "dormant" | "failing";
}

interface AgentMetricsResponse {
  window: { days: number; since: string };
  agents: AgentMetric[];
}

interface RunningData {
  agentTasks: Array<{
    id: string;
    title: string;
    agentName: string | null;
    agentSlug: string | null;
    createdAt: string;
  }>;
  subAgentRuns: Array<{
    id: string;
    name: string;
    task: string;
    startedAt: string;
  }>;
  total: number;
}

type StatSheetType = "agents" | "delegations" | "schedules" | "links" | "running" | null;

// ── Helpers ────────────────────────────────────────────

function buildOrgTree(agents: Agent[]): OrgNode[] {
  const nodeMap = new Map<string, OrgNode>();
  for (const agent of agents) {
    nodeMap.set(agent.id, { agent, children: [] });
  }
  const roots: OrgNode[] = [];
  for (const agent of agents) {
    const node = nodeMap.get(agent.id)!;
    if (agent.parentId && nodeMap.has(agent.parentId)) {
      nodeMap.get(agent.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── Agent Icon ────────────────────────────────────────

function AgentIcon({ slug, size = "sm" }: { slug: string; size?: "sm" | "md" | "lg" }) {
  const { icon: Icon, color, bg } = getAgentIdentity(slug);
  const sizeMap = {
    sm: { container: "h-8 w-8", icon: "h-4 w-4" },
    md: { container: "h-10 w-10", icon: "h-5 w-5" },
    lg: { container: "h-14 w-14", icon: "h-7 w-7" },
  };
  const s = sizeMap[size];
  return (
    <div className={`flex ${s.container} flex-shrink-0 items-center justify-center rounded-full ${bg}`}>
      <Icon className={`${s.icon} ${color}`} />
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  onClick,
  pulse,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
  pulse?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 transition-all duration-150 ${
        onClick ? "cursor-pointer hover:border-border hover:shadow-sm" : ""
      }`}
    >
      <div
        className={`relative flex h-9 w-9 items-center justify-center rounded-lg ${color} bg-opacity-10`}
        style={{ backgroundColor: `color-mix(in srgb, currentColor 10%, transparent)` }}
      >
        <Icon className={`h-4.5 w-4.5 ${color}`} />
        {pulse && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
        )}
      </div>
      <div>
        <p className="text-xl font-semibold tracking-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground leading-none">{label}</p>
      </div>
    </div>
  );
}

// ── Org Tree Node (mobile fallback) ─────────────────────

function OrgTreeNode({
  node,
  depth = 0,
  onSelect,
}: {
  node: OrgNode;
  depth?: number;
  onSelect: (slug: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const agent = node.agent;
  const hasChildren = node.children.length > 0;

  return (
    <div className={depth > 0 ? "ml-5 border-l border-border/40 pl-4" : ""}>
      <div
        onClick={() => onSelect(agent.slug)}
        className="group flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-all duration-150"
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
          className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
            hasChildren
              ? "text-muted-foreground hover:text-foreground hover:bg-muted"
              : "invisible"
          }`}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />
        </button>

        <AgentIcon slug={agent.slug} size="sm" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{agent.name}</span>
            <span
              className={`inline-flex h-1.5 w-1.5 rounded-full ${
                agent.isActive ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-[11px] font-medium capitalize ${ROLE_TEXT[agent.role] || "text-muted-foreground"}`}>
              {agent.role}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {TIER_LABELS[agent.modelTier] || agent.modelTier}
            </span>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground">
          {agent.availableTools.length > 0 && (
            <span className="flex items-center gap-1">
              <Wrench className="h-3 w-3" />
              {agent.availableTools.length}
            </span>
          )}
          {agent.canDelegateTo.length > 0 && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {agent.canDelegateTo.length}
            </span>
          )}
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {hasChildren && isExpanded && (
        <div className="mt-0.5">
          {node.children.map((child) => (
            <OrgTreeNode
              key={child.agent.id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Org Chart Node (desktop flowchart) ──────────────────

function OrgChartNode({
  agent,
  onSelect,
}: {
  agent: Agent;
  onSelect: (slug: string) => void;
}) {
  const { icon: Icon, color, bg } = getAgentIdentity(agent.slug);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={() => onSelect(agent.slug)}
            className="group relative flex flex-col items-center cursor-pointer"
          >
            <div className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-card px-2 py-1.5 shadow-sm hover:border-border hover:shadow-md transition-all duration-200">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full ${bg}`}>
                <Icon className={`h-3.5 w-3.5 ${color}`} />
              </div>
              <div className="text-left max-w-[80px]">
                <p className="text-[11px] font-medium leading-tight truncate">{agent.name}</p>
                <span className={`text-[9px] capitalize ${ROLE_TEXT[agent.role] || "text-muted-foreground"}`}>
                  {agent.role}
                </span>
              </div>
              <span
                className={`absolute top-1 right-1 inline-flex h-1.5 w-1.5 rounded-full ${
                  agent.isActive ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                }`}
              />
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs space-y-1">
          <p className="font-medium">@{agent.slug}</p>
          <p>{agent.availableTools.length} tools &middot; {TIER_LABELS[agent.modelTier] || agent.modelTier}</p>
          {agent.schedule && Object.keys(agent.schedule).length > 0 && (
            <p>{Object.keys(agent.schedule).length} scheduled jobs</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ── Org Chart View (desktop) ────────────────────────────

function OrgChartView({
  orgTree,
  onSelect,
}: {
  agents: Agent[];
  orgTree: OrgNode[];
  onSelect: (slug: string) => void;
}) {
  const executives = orgTree;

  return (
    <div className="rounded-lg border border-border/50 bg-card p-6">
      <div className="flex flex-col items-center">
        {/* Virtual root: Sayed */}
        <div className="flex items-center gap-1.5 rounded-lg border-2 border-foreground/20 bg-foreground/5 px-2.5 py-1.5 shadow-sm">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground/10">
            <User className="h-3.5 w-3.5 text-foreground" />
          </div>
          <div>
            <p className="text-[11px] font-semibold leading-tight">Sayed</p>
            <p className="text-[9px] text-muted-foreground">Founder</p>
          </div>
        </div>

        {/* Vertical connector from Sayed */}
        {executives.length > 0 && <div className="w-px h-4 bg-border" />}

        {/* Horizontal connector spanning from first to last executive */}
        {executives.length > 1 && (
          <div className="w-full flex">
            {executives.map((_, i) => (
              <div key={i} className="flex-1 flex justify-center">
                {/* Left half of connector */}
                <div className={`flex-1 ${i > 0 ? "border-t border-border" : ""}`} />
                {/* Right half of connector */}
                <div className={`flex-1 ${i < executives.length - 1 ? "border-t border-border" : ""}`} />
              </div>
            ))}
          </div>
        )}

        {/* Executive level — each gets flex-1 */}
        {executives.length > 0 && (
          <div className="w-full flex">
            {executives.map((exec) => (
              <div key={exec.agent.id} className="flex-1 flex flex-col items-center">
                <div className="w-px h-4 bg-border" />
                <OrgChartNode agent={exec.agent} onSelect={onSelect} />

                {/* Children of this executive */}
                {exec.children.length > 0 && (
                  <>
                    <div className="w-px h-4 bg-border/70" />

                    {/* Horizontal connector for children */}
                    {exec.children.length > 1 && (
                      <div className="w-full flex">
                        {exec.children.map((_, i) => (
                          <div key={i} className="flex-1 flex justify-center">
                            <div className={`flex-1 ${i > 0 ? "border-t border-border/60" : ""}`} />
                            <div className={`flex-1 ${i < exec.children.length - 1 ? "border-t border-border/60" : ""}`} />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="w-full flex">
                      {exec.children.map((child) => (
                        <div key={child.agent.id} className="flex-1 flex flex-col items-center">
                          <div className="w-px h-4 bg-border/60" />
                          <OrgChartNode agent={child.agent} onSelect={onSelect} />

                          {/* Grandchildren — vertical stack with connector */}
                          {child.children.length > 0 && (
                            <>
                              <div className="w-px h-3 bg-border/40" />
                              <div className="border-l border-border/40 ml-0 pl-4 flex flex-col">
                                {child.children.map((gc, gcIdx) => (
                                  <div key={gc.agent.id} className="flex items-center relative">
                                    {/* Horizontal stub */}
                                    <div className="absolute -left-4 w-4 h-px bg-border/40" />
                                    <div className={gcIdx < child.children.length - 1 ? "mb-1.5" : ""}>
                                      <OrgChartNode agent={gc.agent} onSelect={onSelect} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Card ─────────────────────────────────────────

function AgentCard({
  agent,
  onSelect,
}: {
  agent: Agent;
  onSelect: (slug: string) => void;
}) {
  return (
    <Card
      className="group cursor-pointer border-border/50 hover:border-border hover:shadow-sm transition-all duration-200"
      onClick={() => onSelect(agent.slug)}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <AgentIcon slug={agent.slug} size="md" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">{agent.name}</h3>
                <span
                  className={`inline-flex h-1.5 w-1.5 rounded-full ${
                    agent.isActive ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                  }`}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">@{agent.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex h-2 w-2 rounded-full ${ROLE_DOT[agent.role] || "bg-zinc-400"}`}
            />
            <span
              className={`text-[11px] font-medium capitalize ${ROLE_TEXT[agent.role] || "text-muted-foreground"}`}
            >
              {agent.role}
            </span>
          </div>
        </div>

        {/* Expertise tags */}
        {agent.expertise && agent.expertise.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {agent.expertise.slice(0, 3).map((e) => (
              <span
                key={e}
                className="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {e}
              </span>
            ))}
            {agent.expertise.length > 3 && (
              <span className="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                +{agent.expertise.length - 3}
              </span>
            )}
          </div>
        )}

        <Separator className="opacity-50" />

        {/* Bottom stats */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1">
                    <Wrench className="h-3 w-3" />
                    {agent.availableTools.length}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {agent.availableTools.length} tools available
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    {agent.canDelegateTo.length}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Can delegate to {agent.canDelegateTo.length} agents
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {agent.schedule && Object.keys(agent.schedule).length > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {Object.keys(agent.schedule).length}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {Object.keys(agent.schedule).length} scheduled jobs
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <span className={`font-medium ${TIER_COLORS[agent.modelTier] || "text-muted-foreground"}`}>
            {TIER_LABELS[agent.modelTier] || agent.modelTier}
          </span>
        </div>

        {/* Hover arrow */}
        <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity -mt-1">
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Loading Skeleton ───────────────────────────────────

function AgentsPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] rounded-lg" />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[180px] rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center col-span-full">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 mb-4">
        <Bot className="h-7 w-7 text-muted-foreground/60" />
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">
        {search ? "No agents found" : "No agents yet"}
      </h3>
      <p className="text-[13px] text-muted-foreground max-w-[280px]">
        {search
          ? `No agents match "${search}". Try a different search term.`
          : "Your AI agent team will appear here once configured."}
      </p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────

export default function AgentsPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "tree">("grid");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statSheet, setStatSheet] = useState<StatSheetType>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/agents/admin/seed", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Seed failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents/admin/schedules"] });
      toast({ title: "Agents seeded", description: `${data.seeded ?? ""} agents updated from templates.` });
    },
    onError: () => {
      toast({ title: "Seed failed", description: "Could not seed agents. Check console.", variant: "destructive" });
    },
  });

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch agents");
      return res.json();
    },
  });

  const { data: delegationLog = [] } = useQuery<DelegationLog[]>({
    queryKey: ["/api/agents/delegation/log"],
    queryFn: async () => {
      const res = await fetch("/api/agents/delegation/log", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: schedules = [] } = useQuery<ScheduleJob[]>({
    queryKey: ["/api/agents/admin/schedules"],
    queryFn: async () => {
      const res = await fetch("/api/agents/admin/schedules", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: runningData } = useQuery<RunningData>({
    queryKey: ["/api/agents/admin/running"],
    queryFn: async () => {
      const res = await fetch("/api/agents/admin/running", { credentials: "include" });
      if (!res.ok) return { agentTasks: [], subAgentRuns: [], total: 0 };
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data as RunningData | undefined;
      return d && d.total > 0 ? 10000 : false;
    },
  });

  const runningCount = runningData?.total ?? 0;

  const activeAgents = useMemo(() => agents.filter((a) => a.isActive), [agents]);

  const filteredAgents = useMemo(() => {
    const q = search.toLowerCase();
    return activeAgents.filter((a) => {
      const matchesSearch =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        (a.expertise || []).some((e) => e.toLowerCase().includes(q));
      const matchesRole = roleFilter === "all" || a.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [activeAgents, search, roleFilter]);

  const orgTree = useMemo(() => buildOrgTree(filteredAgents), [filteredAgents]);

  const handleSelect = (slug: string) => navigate(`/agents/${slug}`);

  const activeDelegations = delegationLog.filter(
    (d) => d.status === "pending" || d.status === "in_progress"
  ).length;

  if (isLoading) {
    return <AgentsPageSkeleton />;
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agent HQ</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Manage your AI agent team and delegation workflows
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="gap-2 text-[13px]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${seedMutation.isPending ? "animate-spin" : ""}`} />
            Seed Agents
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/agents/delegation-log")}
            className="gap-2 text-[13px]"
          >
            <FileText className="h-3.5 w-3.5" />
            Delegation Log
            {activeDelegations > 0 && (
              <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500/10 px-1.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                {activeDelegations}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* ── Quick Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="Total Agents"
          value={activeAgents.length}
          icon={Bot}
          color="text-foreground"
          onClick={() => setStatSheet("agents")}
        />
        <StatCard
          label="Active Delegations"
          value={activeDelegations}
          icon={Activity}
          color="text-blue-500"
          onClick={() => setStatSheet("delegations")}
        />
        <StatCard
          label="Scheduled Jobs"
          value={schedules.length}
          icon={Clock}
          color="text-amber-500"
          onClick={() => setStatSheet("schedules")}
        />
        <StatCard
          label="Delegation Links"
          value={activeAgents.reduce((sum, a) => sum + a.canDelegateTo.length, 0)}
          icon={GitBranch}
          color="text-emerald-500"
          onClick={() => setStatSheet("links")}
        />
        <StatCard
          label="Running Now"
          value={runningCount}
          icon={Zap}
          color="text-emerald-500"
          onClick={() => setStatSheet("running")}
          pulse={runningCount > 0}
        />
      </div>

      {/* ── Search + Filters ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search agents by name, role, or expertise..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-[13px]"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Role filter pills */}
          <div className="flex items-center gap-1">
            {["all", "executive", "manager", "specialist", "worker"].map((role) => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium capitalize transition-colors ${
                  roleFilter === role
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {role !== "all" && (
                  <span
                    className={`inline-flex h-1.5 w-1.5 rounded-full ${
                      ROLE_DOT[role] || "bg-zinc-400"
                    }`}
                  />
                )}
                {role}
              </button>
            ))}
          </div>

          <Separator orientation="vertical" className="h-5 mx-1" />

          {/* View toggle */}
          <Tabs
            value={view}
            onValueChange={(v) => setView(v as "grid" | "tree")}
          >
            <TabsList className="h-8">
              <TabsTrigger value="grid" className="h-7 px-2.5 text-[11px] gap-1.5">
                <LayoutGrid className="h-3 w-3" />
                Grid
              </TabsTrigger>
              <TabsTrigger value="tree" className="h-7 px-2.5 text-[11px] gap-1.5">
                <Network className="h-3 w-3" />
                Org Chart
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* ── Content ── */}
      {filteredAgents.length === 0 ? (
        <EmptyState search={search} />
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onSelect={handleSelect} />
          ))}
        </div>
      ) : (
        <>
          {/* Desktop: visual org chart */}
          <div className="hidden lg:block">
            <OrgChartView agents={activeAgents} orgTree={orgTree} onSelect={handleSelect} />
          </div>
          {/* Mobile: indented tree */}
          <div className="lg:hidden rounded-lg border border-border/50 bg-card p-2">
            {orgTree.map((node) => (
              <OrgTreeNode
                key={node.agent.id}
                node={node}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Stat Detail Sheet ── */}
      <Sheet open={statSheet !== null} onOpenChange={(open) => !open && setStatSheet(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {statSheet === "agents" && "All Agents"}
              {statSheet === "delegations" && "Active Delegations"}
              {statSheet === "schedules" && "Scheduled Jobs"}
              {statSheet === "links" && "Delegation Links"}
              {statSheet === "running" && "Running Now"}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {/* ── All Agents ── */}
            {statSheet === "agents" &&
              activeAgents.map((a) => (
                <div
                  key={a.id}
                  onClick={() => { setStatSheet(null); handleSelect(a.slug); }}
                  className="flex items-center gap-3 rounded-lg border border-border/50 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <AgentIcon slug={a.slug} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      @{a.slug} &middot;{" "}
                      <span className={`capitalize ${ROLE_TEXT[a.role] || ""}`}>{a.role}</span> &middot;{" "}
                      <span className={TIER_COLORS[a.modelTier] || ""}>{TIER_LABELS[a.modelTier] || a.modelTier}</span>
                    </p>
                  </div>
                  <span
                    className={`inline-flex h-2 w-2 rounded-full ${
                      a.isActive ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
                    }`}
                  />
                </div>
              ))}

            {/* ── Active Delegations ── */}
            {statSheet === "delegations" && (() => {
              const active = delegationLog.filter(
                (d) => d.status === "pending" || d.status === "in_progress"
              );
              if (active.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No active delegations right now.
                  </p>
                );
              }
              return active.map((d) => {
                const assignee = activeAgents.find((a) => a.id === d.assignedTo);
                const assigner = activeAgents.find((a) => a.id === d.assignedBy);
                return (
                  <div
                    key={d.id}
                    className="rounded-lg border border-border/50 p-3 space-y-1.5"
                  >
                    <p className="text-sm font-medium">{d.title}</p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Badge
                        variant={d.status === "in_progress" ? "default" : "secondary"}
                        className="text-[10px] h-5"
                      >
                        {d.status}
                      </Badge>
                      {d.deliverableType && (
                        <Badge variant="outline" className="text-[10px] h-5">
                          {d.deliverableType}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {assigner?.name || d.assignedBy} &rarr; {assignee?.name || "Unknown"}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {new Date(d.createdAt).toLocaleString()}
                    </p>
                  </div>
                );
              });
            })()}

            {/* ── Scheduled Jobs ── */}
            {statSheet === "schedules" && (() => {
              if (schedules.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No scheduled jobs configured.
                  </p>
                );
              }
              return schedules.map((s, i) => (
                <div
                  key={`${s.agentSlug}-${s.jobName}-${i}`}
                  onClick={() => { setStatSheet(null); handleSelect(s.agentSlug); }}
                  className="rounded-lg border border-border/50 p-3 space-y-1 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{s.jobName}</p>
                    <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground font-mono">
                      {s.cronExpression}
                    </code>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Agent: @{s.agentSlug}
                  </p>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                    <span>{s.runCount} runs</span>
                    {s.errorCount > 0 && (
                      <span className="text-red-500">{s.errorCount} errors</span>
                    )}
                    {s.lastRun && (
                      <span>Last: {new Date(s.lastRun).toLocaleString()}</span>
                    )}
                  </div>
                </div>
              ));
            })()}

            {/* ── Delegation Links ── */}
            {statSheet === "links" &&
              activeAgents
                .filter((a) => a.canDelegateTo.length > 0)
                .map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-border/50 p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{a.name}</span>
                      <span className="text-[11px] text-muted-foreground">@{a.slug}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {a.canDelegateTo.map((targetSlug) => {
                        const target = activeAgents.find((t) => t.slug === targetSlug);
                        return (
                          <span
                            key={targetSlug}
                            onClick={() => { setStatSheet(null); handleSelect(targetSlug); }}
                            className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-[11px] cursor-pointer hover:bg-muted transition-colors"
                          >
                            <GitBranch className="h-3 w-3 text-muted-foreground" />
                            {target?.name || targetSlug}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}

            {/* ── Running Now ── */}
            {statSheet === "running" && (() => {
              if (!runningData || runningData.total === 0) {
                return (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No tasks running right now.
                  </p>
                );
              }
              return (
                <>
                  {runningData.agentTasks.map((t: RunningData["agentTasks"][number]) => (
                    <div
                      key={t.id}
                      onClick={() => {
                        if (t.agentSlug) {
                          setStatSheet(null);
                          handleSelect(t.agentSlug);
                        }
                      }}
                      className="flex items-center gap-3 rounded-lg border border-border/50 p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      {t.agentSlug && <AgentIcon slug={t.agentSlug} size="sm" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{t.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t.agentName || "Unknown agent"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-blue-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {formatElapsed(t.createdAt)}
                      </div>
                    </div>
                  ))}
                  {runningData.subAgentRuns.map((r: RunningData["subAgentRuns"][number]) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-lg border border-border/50 p-3"
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/10">
                        <Zap className="h-4 w-4 text-violet-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{r.task}</p>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-blue-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {formatElapsed(r.startedAt)}
                      </div>
                    </div>
                  ))}
                </>
              );
            })()}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
