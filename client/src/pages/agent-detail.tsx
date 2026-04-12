import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Bot,
  Brain,
  ChevronRight,
  Clock,
  GitBranch,
  Loader2,
  Shield,
  Target,
  Wrench,
  Zap,
  CheckCircle2,
  Circle,
  AlertCircle,
  XCircle,
  History,
  Database,
  ScanLine,
} from "lucide-react";
import {
  getAgentIdentity,
  ROLE_DOT,
  ROLE_TEXT,
  TIER_LABELS,
  TIER_COLORS,
} from "@/lib/agent-identity";
import { DecisionTracePanel } from "@/components/decisions/decision-trace-panel";

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

interface AgentTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignedBy: string;
  createdAt: string;
  completedAt: string | null;
  result: string | null;
}

interface AgentMemory {
  id: string;
  key: string;
  value: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ── Constants ──────────────────────────────────────────

const TASK_STATUS_ICON: Record<string, React.ElementType> = {
  pending: Circle,
  in_progress: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
};

const TASK_STATUS_COLOR: Record<string, string> = {
  pending: "text-amber-500",
  in_progress: "text-blue-500",
  completed: "text-emerald-500",
  failed: "text-red-500",
};

// ── Overview Tab ───────────────────────────────────────

function OverviewTab({ agent }: { agent: Agent }) {
  const soulExcerpt = agent.soul
    ? agent.soul.length > 300
      ? agent.soul.slice(0, 300) + "..."
      : agent.soul
    : null;

  const scheduleEntries = agent.schedule ? Object.entries(agent.schedule) : [];

  return (
    <div className="space-y-6 py-1">
      {soulExcerpt && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Personality
          </h3>
          <p className="text-[13px] text-muted-foreground leading-relaxed rounded-lg bg-muted/30 p-3 border border-border/30">
            {soulExcerpt}
          </p>
        </div>
      )}

      {agent.expertise && agent.expertise.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Expertise
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {agent.expertise.map((e) => (
              <span
                key={e}
                className="inline-flex items-center rounded-md bg-muted/60 px-2.5 py-1 text-[12px] text-foreground/80"
              >
                {e}
              </span>
            ))}
          </div>
        </div>
      )}

      {agent.availableTools.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Wrench className="h-3 w-3" />
            Tools ({agent.availableTools.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {agent.availableTools.map((tool) => (
              <span
                key={tool}
                className="inline-flex items-center gap-1 rounded-md bg-blue-500/5 border border-blue-500/10 px-2 py-0.5 text-[11px] text-blue-600 dark:text-blue-400"
              >
                <Zap className="h-2.5 w-2.5" />
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}

      {agent.actionPermissions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Shield className="h-3 w-3" />
            Permissions ({agent.actionPermissions.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {agent.actionPermissions.map((perm) => (
              <span
                key={perm}
                className="inline-flex items-center rounded-md bg-amber-500/5 border border-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400"
              >
                {perm}
              </span>
            ))}
          </div>
        </div>
      )}

      {agent.canDelegateTo.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <GitBranch className="h-3 w-3" />
            Can Delegate To ({agent.canDelegateTo.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {agent.canDelegateTo.map((slug) => (
              <span
                key={slug}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500/5 border border-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400"
              >
                @{slug}
              </span>
            ))}
          </div>
        </div>
      )}

      {scheduleEntries.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Schedule
          </h3>
          <div className="space-y-1.5">
            {scheduleEntries.map(([name, cron]) => (
              <div
                key={name}
                className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 border border-border/30"
              >
                <span className="text-[12px] text-foreground/80">
                  {name.replace(/_/g, " ")}
                </span>
                <code className="text-[10px] text-muted-foreground font-mono">
                  {cron}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Model Configuration
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md bg-muted/30 px-3 py-2 border border-border/30">
            <p className="text-[10px] text-muted-foreground mb-0.5">Model Tier</p>
            <p className={`text-[13px] font-medium ${TIER_COLORS[agent.modelTier] || ""}`}>
              {TIER_LABELS[agent.modelTier] || agent.modelTier}
            </p>
          </div>
          <div className="rounded-md bg-muted/30 px-3 py-2 border border-border/30">
            <p className="text-[10px] text-muted-foreground mb-0.5">Temperature</p>
            <p className="text-[13px] font-medium">{agent.temperature}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tasks Tab ──────────────────────────────────────────

function TasksTab({ slug }: { slug: string }) {
  const { data: tasks = [], isLoading } = useQuery<AgentTask[]>({
    queryKey: ["/api/agents", slug, "tasks"],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${slug}/tasks`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: (query) => {
      const taskList = query.state.data as AgentTask[] | undefined;
      return taskList?.some((t) => t.status === "in_progress") ? 5000 : false;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3 py-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 mb-3">
          <Target className="h-5 w-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm font-medium mb-1">No tasks assigned</p>
        <p className="text-[12px] text-muted-foreground max-w-[240px]">
          Tasks delegated to this agent will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 py-1">
      {tasks.map((task) => {
        const StatusIcon = TASK_STATUS_ICON[task.status] || Circle;
        const statusColor = TASK_STATUS_COLOR[task.status] || "text-muted-foreground";
        return (
          <div
            key={task.id}
            className="flex items-start gap-3 rounded-lg border border-border/30 bg-muted/20 p-3 hover:bg-muted/30 transition-colors"
          >
            <StatusIcon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${statusColor} ${task.status === "in_progress" ? "animate-spin" : ""}`} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium truncate">{task.title}</p>
              {task.description && (
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                  {task.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                <span className="capitalize">{task.status.replace(/_/g, " ")}</span>
                {task.status === "in_progress" && (
                  <>
                    <span className="text-border">|</span>
                    <span className="text-blue-500 font-medium">
                      {(() => {
                        const ms = Date.now() - new Date(task.createdAt).getTime();
                        const m = Math.floor(ms / 60000);
                        if (m < 60) return `${m}m`;
                        return `${Math.floor(m / 60)}h ${m % 60}m`;
                      })()}
                    </span>
                  </>
                )}
                {task.priority && (
                  <>
                    <span className="text-border">|</span>
                    <span>{task.priority}</span>
                  </>
                )}
                <span className="text-border">|</span>
                <span>{new Date(task.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Memory Tab ─────────────────────────────────────────

function MemoryTab({ slug }: { slug: string }) {
  const { data: memories = [], isLoading } = useQuery<AgentMemory[]>({
    queryKey: ["/api/agents", slug, "memory"],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${slug}/memory`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3 py-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 mb-3">
          <Database className="h-5 w-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm font-medium mb-1">No memories stored</p>
        <p className="text-[12px] text-muted-foreground max-w-[240px]">
          This agent hasn't stored any memories yet. Memories accumulate through interactions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 py-1">
      {memories.map((mem) => (
        <div
          key={mem.id}
          className="rounded-lg border border-border/30 bg-muted/20 p-3"
        >
          <div className="flex items-center justify-between mb-1.5">
            <code className="text-[11px] font-mono text-foreground/80">{mem.key}</code>
            {mem.category && (
              <span className="text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5">
                {mem.category}
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed">{mem.value}</p>
          <p className="text-[10px] text-muted-foreground/60 mt-1.5">
            {new Date(mem.updatedAt || mem.createdAt).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Activity Tab ───────────────────────────────────────

function ActivityTab({ slug }: { slug: string }) {
  const { data: conversations = [], isLoading } = useQuery<ConversationMessage[]>({
    queryKey: ["/api/agents", slug, "conversations"],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${slug}/conversations`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const grouped = useMemo(() => {
    const groups: Record<string, ConversationMessage[]> = {};
    const filtered = conversations.filter((m) => m.role !== "system");
    for (const msg of filtered) {
      const date = new Date(msg.createdAt).toLocaleDateString();
      if (!groups[date]) groups[date] = [];
      groups[date].push(msg);
    }
    return Object.entries(groups).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [conversations]);

  if (isLoading) {
    return (
      <div className="space-y-3 py-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 mb-3">
          <History className="h-5 w-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm font-medium mb-1">No activity yet</p>
        <p className="text-[12px] text-muted-foreground max-w-[240px]">
          Start a conversation to see activity history.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-1">
      {grouped.map(([date, messages]) => (
        <div key={date}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {date}
          </p>
          <div className="space-y-1.5">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/30 transition-colors"
              >
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0 mt-0.5 ${
                    msg.role === "user" ? "bg-foreground/10" : "bg-muted"
                  }`}
                >
                  {msg.role === "user" ? (
                    <span className="text-[8px] font-semibold text-foreground/70">SB</span>
                  ) : (
                    <Bot className="h-2.5 w-2.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-foreground/80 truncate">{msg.content}</p>
                  <p className="text-[10px] text-muted-foreground/50">
                    {new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Loading Skeleton ───────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded" />
        <Skeleton className="h-6 w-48" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────

export default function AgentDetailPage() {
  const [, params] = useRoute("/agents/:slug");
  const [, navigate] = useLocation();
  const slug = String(params?.slug || "");
  const [activeTab, setActiveTab] = useState("overview");

  const { data: agent, isLoading, error } = useQuery<Agent>({
    queryKey: ["/api/agents", slug],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${slug}`, { credentials: "include" });
      if (!res.ok) throw new Error("Agent not found");
      return res.json();
    },
    enabled: !!slug,
  });

  if (isLoading) return <DetailSkeleton />;

  if (error || !agent) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 mb-4">
            <AlertCircle className="h-7 w-7 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold mb-1">Agent not found</h2>
          <p className="text-[13px] text-muted-foreground mb-4">
            The agent "{slug}" could not be found.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate("/agents")}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
            Back to Agent HQ
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
      {/* ── Back + Breadcrumb ── */}
      <div className="flex items-center gap-2 text-[13px]">
        <button
          onClick={() => navigate("/agents")}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Agent HQ
        </button>
        <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
        <span className="text-foreground font-medium">{agent.name}</span>
      </div>

      {/* ── Agent Header ── */}
      <div className="flex items-start gap-4">
        {(() => {
          const { icon: AgentIconComp, color: agentColor, bg: agentBg } = getAgentIdentity(agent.slug);
          return (
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${agentBg} flex-shrink-0`}>
              <AgentIconComp className={`h-7 w-7 ${agentColor}`} />
            </div>
          );
        })()}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
            <span
              className={`inline-flex h-2 w-2 rounded-full ${
                agent.isActive ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"
              }`}
            />
            <span className="text-[11px] text-muted-foreground">
              {agent.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[13px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className={`inline-flex h-1.5 w-1.5 rounded-full ${ROLE_DOT[agent.role] || "bg-zinc-400"}`} />
              <span className={`capitalize font-medium ${ROLE_TEXT[agent.role] || ""}`}>
                {agent.role}
              </span>
            </span>
            <span className="text-border">|</span>
            <span className={`font-medium ${TIER_COLORS[agent.modelTier] || ""}`}>
              {TIER_LABELS[agent.modelTier] || agent.modelTier}
            </span>
            <span className="text-border">|</span>
            <span>@{agent.slug}</span>
          </div>
        </div>
      </div>

      {/* ── Info Tabs (full width) ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start h-9 bg-muted/30 border border-border/30">
          <TabsTrigger value="overview" className="text-[12px] gap-1.5 h-7">
            <Brain className="h-3 w-3" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-[12px] gap-1.5 h-7">
            <Target className="h-3 w-3" />
            Tasks
          </TabsTrigger>
          <TabsTrigger value="memory" className="text-[12px] gap-1.5 h-7">
            <Database className="h-3 w-3" />
            Memory
          </TabsTrigger>
          <TabsTrigger value="activity" className="text-[12px] gap-1.5 h-7">
            <History className="h-3 w-3" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="decisions" className="text-[12px] gap-1.5 h-7">
            <ScanLine className="h-3 w-3" />
            Decisions
          </TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="overview" className="mt-0">
            <OverviewTab agent={agent} />
          </TabsContent>
          <TabsContent value="tasks" className="mt-0">
            <TasksTab slug={slug} />
          </TabsContent>
          <TabsContent value="memory" className="mt-0">
            <MemoryTab slug={slug} />
          </TabsContent>
          <TabsContent value="activity" className="mt-0">
            <ActivityTab slug={slug} />
          </TabsContent>
          <TabsContent value="decisions" className="mt-0">
            <DecisionTracePanel agentSlug={slug} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
