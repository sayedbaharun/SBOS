import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  Search,
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ArrowRight,
  Activity,
  Filter,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────

interface DelegationEntry {
  id: string;
  title: string;
  description: string;
  assignedBy: string;
  assignedTo: string;
  delegationChain: string[];
  status: string;
  priority: string;
  result: Record<string, any> | string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ── Constants ──────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { dot: string; text: string; icon: React.ElementType; bg: string }
> = {
  pending: {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    icon: Circle,
    bg: "bg-amber-500/5",
  },
  in_progress: {
    dot: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    icon: Loader2,
    bg: "bg-blue-500/5",
  },
  completed: {
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    icon: CheckCircle2,
    bg: "bg-emerald-500/5",
  },
  failed: {
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    icon: XCircle,
    bg: "bg-red-500/5",
  },
};

const PRIORITY_CONFIG: Record<string, { color: string }> = {
  critical: { color: "text-red-500" },
  high: { color: "text-amber-500" },
  medium: { color: "text-blue-500" },
  low: { color: "text-muted-foreground" },
};

// ── Stat Card ──────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-3">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{
          backgroundColor: `color-mix(in srgb, currentColor 10%, transparent)`,
        }}
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

// ── Delegation Row ─────────────────────────────────────

function DelegationRow({ entry }: { entry: DelegationEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const config = STATUS_CONFIG[entry.status] || STATUS_CONFIG.pending;
  const StatusIcon = config.icon;
  const priorityConfig = PRIORITY_CONFIG[entry.priority] || PRIORITY_CONFIG.medium;

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const duration = entry.completedAt
    ? (() => {
        const diff =
          new Date(entry.completedAt).getTime() -
          new Date(entry.createdAt).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ${mins % 60}m`;
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
      })()
    : null;

  return (
    <div className="border border-border/30 rounded-lg overflow-hidden hover:border-border/60 transition-colors">
      {/* Main row */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Expand icon */}
          <ChevronDown
            className={`h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0 transition-transform duration-200 ${
              isExpanded ? "" : "-rotate-90"
            }`}
          />

          {/* Status */}
          <StatusIcon
            className={`h-4 w-4 flex-shrink-0 ${config.text} ${
              entry.status === "in_progress" ? "animate-spin" : ""
            }`}
          />

          {/* Title + description */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate">{entry.title}</p>
            {entry.description && (
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                {entry.description}
              </p>
            )}
          </div>

          {/* From -> To */}
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground flex-shrink-0">
            <span className="font-medium text-foreground/70">@{entry.assignedBy}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
            <span className="font-medium text-foreground/70">@{entry.assignedTo}</span>
          </div>

          {/* Priority */}
          <span
            className={`hidden md:inline text-[10px] font-medium uppercase ${priorityConfig.color} flex-shrink-0`}
          >
            {entry.priority}
          </span>

          {/* Time */}
          <span className="text-[10px] text-muted-foreground flex-shrink-0 hidden lg:inline">
            {timeAgo(entry.createdAt)}
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border/20 px-4 py-3 bg-muted/10 space-y-3">
          {/* Mobile: from/to display */}
          <div className="sm:hidden flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">@{entry.assignedBy}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
            <span className="font-medium text-foreground/70">@{entry.assignedTo}</span>
          </div>

          {/* Description */}
          {entry.description && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Description
              </p>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                {entry.description}
              </p>
            </div>
          )}

          {/* Delegation chain */}
          {entry.delegationChain && entry.delegationChain.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                Delegation Chain
              </p>
              <div className="flex items-center gap-1 flex-wrap">
                {entry.delegationChain.map((slug, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] text-foreground/80">
                      <GitBranch className="h-2.5 w-2.5" />
                      @{slug}
                    </span>
                    {i < entry.delegationChain.length - 1 && (
                      <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live plan artifact (shown for in-progress tasks) */}
          {entry.status === "in_progress" && typeof entry.result === "object" && entry.result?.plan && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 mb-1">
                Live Plan
              </p>
              <pre className="text-[11px] text-foreground/80 leading-relaxed rounded-md bg-blue-500/5 border border-blue-500/10 p-2.5 whitespace-pre-wrap font-mono">
                {String(entry.result.plan)}
              </pre>
            </div>
          )}

          {/* Result or Error */}
          {entry.result && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500 mb-1">
                Result
              </p>
              <p className="text-[12px] text-foreground/80 leading-relaxed rounded-md bg-emerald-500/5 border border-emerald-500/10 p-2.5">
                {typeof entry.result === "string"
                  ? entry.result
                  : (entry.result as any).title || (entry.result as any).summary || JSON.stringify(entry.result).slice(0, 200)}
              </p>
            </div>
          )}

          {entry.error && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1">
                Error
              </p>
              <p className="text-[12px] text-red-600 dark:text-red-400 leading-relaxed rounded-md bg-red-500/5 border border-red-500/10 p-2.5">
                {entry.error}
              </p>
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created: {new Date(entry.createdAt).toLocaleString()}
            </span>
            {entry.completedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Completed: {new Date(entry.completedAt).toLocaleString()}
              </span>
            )}
            {duration && (
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                Duration: {duration}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Loading Skeleton ───────────────────────────────────

function DelegationLogSkeleton() {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="space-y-1">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-9 w-72" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ── Empty State ────────────────────────────────────────

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 mb-4">
        <FileText className="h-7 w-7 text-muted-foreground/60" />
      </div>
      <h3 className="text-sm font-medium text-foreground mb-1">
        {search ? "No delegations found" : "No delegations yet"}
      </h3>
      <p className="text-[13px] text-muted-foreground max-w-[300px]">
        {search
          ? `No delegations match "${search}". Try different search terms.`
          : "When agents delegate tasks to each other, the audit trail will appear here."}
      </p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────

export default function DelegationLogPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: delegations = [], isLoading } = useQuery<DelegationEntry[]>({
    queryKey: ["/api/agents/delegation/log"],
    queryFn: async () => {
      const res = await fetch("/api/agents/delegation/log", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch delegation log");
      return res.json();
    },
  });

  // Compute stats
  const stats = useMemo(
    () => ({
      total: delegations.length,
      completed: delegations.filter((d) => d.status === "completed").length,
      inProgress: delegations.filter((d) => d.status === "in_progress").length,
      failed: delegations.filter((d) => d.status === "failed").length,
      pending: delegations.filter((d) => d.status === "pending").length,
    }),
    [delegations]
  );

  // Filter
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return delegations.filter((d) => {
      const matchesSearch =
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.assignedBy.toLowerCase().includes(q) ||
        d.assignedTo.toLowerCase().includes(q) ||
        (d.description || "").toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === "all" || d.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [delegations, search, statusFilter]);

  if (isLoading) return <DelegationLogSkeleton />;

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-6">
      {/* ── Back link ── */}
      <button
        onClick={() => navigate("/agents")}
        className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Agent HQ
      </button>

      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Delegation Audit Trail
        </h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Track all task delegations between agents with full chain visibility
        </p>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Delegations"
          value={stats.total}
          icon={FileText}
          color="text-foreground"
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          color="text-emerald-500"
        />
        <StatCard
          label="In Progress"
          value={stats.inProgress}
          icon={Activity}
          color="text-blue-500"
        />
        <StatCard
          label="Failed"
          value={stats.failed}
          icon={XCircle}
          color="text-red-500"
        />
      </div>

      {/* ── Search + Filters ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by title or agent name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-[13px]"
          />
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1">
          {[
            { key: "all", label: "All" },
            { key: "pending", label: "Pending" },
            { key: "in_progress", label: "Active" },
            { key: "completed", label: "Done" },
            { key: "failed", label: "Failed" },
          ].map(({ key, label }) => {
            const config = STATUS_CONFIG[key];
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  statusFilter === key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {config && (
                  <span
                    className={`inline-flex h-1.5 w-1.5 rounded-full ${config.dot}`}
                  />
                )}
                {label}
                {key !== "all" && (
                  <span className="text-[10px] opacity-60">
                    {key === "pending"
                      ? stats.pending
                      : key === "in_progress"
                      ? stats.inProgress
                      : key === "completed"
                      ? stats.completed
                      : stats.failed}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Delegation List ── */}
      {filtered.length === 0 ? (
        <EmptyState search={search} />
      ) : (
        <div className="space-y-2">
          {/* Column headers (desktop) */}
          <div className="hidden md:flex items-center gap-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span className="w-3.5" /> {/* Expand */}
            <span className="w-4" /> {/* Status icon */}
            <span className="flex-1">Title</span>
            <span className="w-40 text-center">Delegation</span>
            <span className="w-16 text-center">Priority</span>
            <span className="w-16 text-right">Time</span>
          </div>

          {filtered.map((entry) => (
            <DelegationRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* ── Footer summary ── */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-2">
          <span>
            Showing {filtered.length} of {delegations.length} delegations
          </span>
          {statusFilter !== "all" && (
            <button
              onClick={() => setStatusFilter("all")}
              className="text-foreground/70 hover:text-foreground transition-colors"
            >
              Clear filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}
