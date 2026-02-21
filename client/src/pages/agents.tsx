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
  CircleDot,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  status: string;
}

interface ScheduleJob {
  id: string;
}

// ── Constants ──────────────────────────────────────────

const ROLE_DOT: Record<string, string> = {
  executive: "bg-purple-500",
  manager: "bg-blue-500",
  specialist: "bg-emerald-500",
  worker: "bg-amber-500",
};

const ROLE_TEXT: Record<string, string> = {
  executive: "text-purple-600 dark:text-purple-400",
  manager: "text-blue-600 dark:text-blue-400",
  specialist: "text-emerald-600 dark:text-emerald-400",
  worker: "text-amber-600 dark:text-amber-400",
};

const TIER_LABELS: Record<string, string> = {
  top: "Opus",
  mid: "Sonnet",
  fast: "Haiku",
  auto: "Auto",
};

const TIER_COLORS: Record<string, string> = {
  top: "text-purple-500",
  mid: "text-blue-500",
  fast: "text-emerald-500",
  auto: "text-muted-foreground",
};

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

// ── Stat Card ──────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-3">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-lg ${color} bg-opacity-10`}
        style={{ backgroundColor: `color-mix(in srgb, currentColor 10%, transparent)` }}
      >
        <Icon className={`h-4.5 w-4.5 ${color}`} />
      </div>
      <div>
        <p className="text-xl font-semibold tracking-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground leading-none">{label}</p>
      </div>
    </div>
  );
}

// ── Org Tree Node ──────────────────────────────────────

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
        {/* Expand toggle */}
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

        {/* Avatar */}
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted/80">
          <Bot className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Info */}
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

        {/* Meta counts */}
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

      {/* Children */}
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
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/80">
              <Bot className="h-5 w-5 text-muted-foreground" />
            </div>
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
      {/* Header skeleton */}
      <div className="space-y-1">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Stats skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] rounded-lg" />
        ))}
      </div>

      {/* Search skeleton */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-40" />
      </div>

      {/* Cards skeleton */}
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

  const filteredAgents = useMemo(() => {
    const q = search.toLowerCase();
    return agents.filter((a) => {
      const matchesSearch =
        !q ||
        a.name.toLowerCase().includes(q) ||
        a.slug.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        (a.expertise || []).some((e) => e.toLowerCase().includes(q));
      const matchesRole = roleFilter === "all" || a.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [agents, search, roleFilter]);

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Agents"
          value={agents.length}
          icon={Bot}
          color="text-foreground"
        />
        <StatCard
          label="Active Delegations"
          value={activeDelegations}
          icon={Activity}
          color="text-blue-500"
        />
        <StatCard
          label="Scheduled Jobs"
          value={schedules.length}
          icon={Clock}
          color="text-amber-500"
        />
        <StatCard
          label="Delegation Links"
          value={agents.reduce((sum, a) => sum + a.canDelegateTo.length, 0)}
          icon={GitBranch}
          color="text-emerald-500"
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
                Org Tree
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
        <div className="rounded-lg border border-border/50 bg-card p-2">
          {orgTree.map((node) => (
            <OrgTreeNode
              key={node.agent.id}
              node={node}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
