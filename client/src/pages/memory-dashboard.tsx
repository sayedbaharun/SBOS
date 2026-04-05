import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Brain,
  Database,
  Activity,
  Search,
  GitBranch,
  Clock,
  Star,
  CheckCircle,
  AlertCircle,
  XCircle,
  ArrowRight,
  RefreshCw,
  Network,
  Users,
  Layers,
  FileText,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ── Types ────────────────────────────────────────────────────────────────────

interface MemoryStatus {
  qdrant: { available: boolean; collectionsCount?: number; totalVectors?: number; error?: string };
  pinecone: { available: boolean; indexName?: string; error?: string };
  embeddings: { available: boolean; model?: string; provider?: string };
  sync: { running: boolean; online: boolean; bufferedEvents: number };
  taskQueue: { queued: number; running: number; completed: number; failed: number };
  ready: boolean;
}

interface RecentMemory {
  id: string;
  content: string;
  memoryType: string;
  importance: number | null;
  scope: string | null;
  tags: string[] | null;
  createdAt: string;
  agentName: string | null;
  agentSlug: string | null;
}

interface DecisionMemory {
  id: string;
  context: string;
  decision: string;
  reasoning: string | null;
  outcome: string | null;
  outcomeNotes: string | null;
  tags: string[] | null;
  createdAt: string;
  followUpAt: string | null;
}

interface EntityRow {
  name: string;
  type: string | null;
  mentionCount: number;
  lastSeen: string | null;
}

interface MemoryMetrics {
  arms?: { vector?: { latency_ms?: number; hit_rate?: number }; keyword?: { latency_ms?: number; hit_rate?: number }; graph?: { latency_ms?: number; hit_rate?: number } };
  total_retrievals?: number;
}

interface SearchResult {
  id: string;
  text: string;
  type: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const ENTITY_COLORS: Record<string, string> = {
  person: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  organization: "bg-green-500/20 text-green-400 border-green-500/30",
  project: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  concept: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  location: "bg-red-500/20 text-red-400 border-red-500/30",
  venture: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const MEMORY_TYPE_ICONS: Record<string, string> = {
  learning: "📚",
  preference: "⚙️",
  decision: "🎯",
  context: "💡",
  fact: "📌",
};

const OUTCOME_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  success: { icon: CheckCircle, color: "text-green-400", label: "Success" },
  mixed: { icon: AlertCircle, color: "text-yellow-400", label: "Mixed" },
  failure: { icon: XCircle, color: "text-red-400", label: "Failure" },
  unknown: { icon: AlertCircle, color: "text-muted-foreground", label: "Unknown" },
};

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={cn("inline-block w-2 h-2 rounded-full", ok ? "bg-green-500" : "bg-red-500")} />
  );
}

function ImportancePip({ value }: { value: number | null }) {
  const v = value ?? 0.5;
  return (
    <div className="flex gap-0.5 items-center">
      {[0.25, 0.5, 0.75, 1.0].map((thresh) => (
        <div
          key={thresh}
          className={cn("w-1.5 h-1.5 rounded-full", v >= thresh ? "bg-amber-400" : "bg-muted")}
        />
      ))}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HealthStrip({ status }: { status: MemoryStatus }) {
  const stores = [
    { label: "Qdrant", ok: status.qdrant.available, detail: status.qdrant.totalVectors != null ? `${status.qdrant.totalVectors.toLocaleString()} vectors` : status.qdrant.error ?? "unavailable" },
    { label: "Pinecone", ok: status.pinecone.available, detail: status.pinecone.indexName ?? status.pinecone.error ?? "unavailable" },
    { label: "Embeddings", ok: status.embeddings.available, detail: status.embeddings.model ?? "not configured" },
    { label: "Sync", ok: status.sync.online, detail: status.sync.bufferedEvents > 0 ? `${status.sync.bufferedEvents} buffered` : "live" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stores.map((s) => (
        <div key={s.label} className="bg-muted/40 rounded-lg px-3 py-2.5 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <StatusDot ok={s.ok} />
            <span className="text-xs font-medium">{s.label}</span>
          </div>
          <span className="text-xs text-muted-foreground truncate">{s.detail}</span>
        </div>
      ))}
    </div>
  );
}

function MetricsPanel({ metrics }: { metrics: MemoryMetrics | undefined }) {
  if (!metrics?.arms) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        No retrieval data yet — metrics populate after the first memory search.
      </div>
    );
  }

  const arms = [
    { name: "Vector (Qdrant)", key: "vector", weight: "55%", color: "bg-blue-500" },
    { name: "Keyword (PG)", key: "keyword", weight: "25%", color: "bg-green-500" },
    { name: "Graph (FalkorDB)", key: "graph", weight: "20%", color: "bg-orange-500" },
  ] as const;

  return (
    <div className="grid grid-cols-3 gap-3">
      {arms.map((arm) => {
        const data = metrics.arms?.[arm.key] ?? {};
        const hitRate = (data.hit_rate ?? 0) * 100;
        const latency = data.latency_ms ?? 0;
        return (
          <div key={arm.key} className="bg-muted/40 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{arm.name}</span>
              <span className="text-xs text-muted-foreground">{arm.weight}</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Hit rate</span>
                <span className="font-mono">{hitRate.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", arm.color)} style={{ width: `${hitRate}%` }} />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {latency > 0 ? `${latency.toFixed(0)}ms avg` : "no data"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RecentMemoriesList({ memories }: { memories: RecentMemory[] }) {
  if (memories.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">No memories stored yet.</div>;
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2 pr-2">
        {memories.map((m) => (
          <div key={m.id} className="bg-muted/30 rounded-lg p-3 space-y-1.5 hover:bg-muted/50 transition-colors">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {MEMORY_TYPE_ICONS[m.memoryType] ?? "💾"} {m.agentName ?? "Unknown agent"}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <ImportancePip value={m.importance} />
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
            <p className="text-sm leading-snug line-clamp-2">{m.content}</p>
            {m.tags && m.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {m.tags.slice(0, 4).map((t) => (
                  <Badge key={t} variant="outline" className="text-xs py-0 px-1.5">{t}</Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function DecisionJournal({ decisions }: { decisions: DecisionMemory[] }) {
  if (decisions.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">No decisions recorded yet. Use the Decision Journal to log key decisions.</div>;
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-3 pr-2">
        {decisions.map((d) => {
          const outcome = d.outcome ? OUTCOME_CONFIG[d.outcome] : null;
          const OutcomeIcon = outcome?.icon;
          return (
            <div key={d.id} className="bg-muted/30 rounded-lg p-3 space-y-2 hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground line-clamp-1">{d.context}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {outcome && OutcomeIcon && (
                    <OutcomeIcon className={cn("h-3.5 w-3.5", outcome.color)} />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                  </span>
                </div>
              </div>
              <p className="text-sm font-medium leading-snug">{d.decision}</p>
              {d.outcomeNotes && (
                <p className="text-xs text-muted-foreground italic">{d.outcomeNotes}</p>
              )}
              {d.tags && d.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {d.tags.slice(0, 4).map((t) => (
                    <Badge key={t} variant="outline" className="text-xs py-0 px-1.5">{t}</Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function EntityBrowser({ entities }: { entities: EntityRow[] }) {
  const [filter, setFilter] = useState("");

  const filtered = entities.filter(
    (e) =>
      e.name.toLowerCase().includes(filter.toLowerCase()) ||
      (e.type ?? "").toLowerCase().includes(filter.toLowerCase())
  );

  if (entities.length === 0) {
    return <div className="text-sm text-muted-foreground p-4">No entities extracted yet. Entities appear after agent conversations are compacted.</div>;
  }

  return (
    <div className="space-y-3">
      <Input
        placeholder="Filter entities..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="h-8 text-sm"
      />
      <ScrollArea className="h-[360px]">
        <div className="space-y-1.5 pr-2">
          {filtered.map((e) => (
            <div key={e.name} className="flex items-center justify-between bg-muted/30 rounded px-3 py-2 hover:bg-muted/50 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  variant="outline"
                  className={cn("text-xs py-0 px-1.5 shrink-0", ENTITY_COLORS[e.type ?? "concept"] ?? ENTITY_COLORS.concept)}
                >
                  {e.type ?? "concept"}
                </Badge>
                <span className="text-sm truncate">{e.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> {e.mentionCount}
                </span>
                {e.lastSeen && (
                  <span>{formatDistanceToNow(new Date(e.lastSeen), { addSuffix: true })}</span>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-sm text-muted-foreground p-2">No entities match "{filter}"</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function SearchPlayground() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { toast } = useToast();

  const { data: results, isLoading } = useQuery<SearchResult[]>({
    queryKey: ["memory-search", submitted],
    enabled: submitted.length > 0,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/memory/search", {
        query: submitted,
        limit: 10,
      });
      return res.json();
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Search your memories..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) setSubmitted(query.trim()); }}
          className="h-9"
        />
        <Button
          size="sm"
          disabled={!query.trim() || isLoading}
          onClick={() => { if (query.trim()) setSubmitted(query.trim()); }}
        >
          {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </div>

      {submitted && (
        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))
          ) : results && results.length > 0 ? (
            results.map((r, i) => (
              <div key={r.id || i} className="bg-muted/30 rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">{r.type}</Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm line-clamp-3">{r.text}</p>
              </div>
            ))
          ) : (
            <div className="text-sm text-muted-foreground p-2">No results for "{submitted}"</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MemoryDashboard() {
  const [, navigate] = useLocation();

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<MemoryStatus>({
    queryKey: ["memory-status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/memory/status");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const { data: metrics } = useQuery<MemoryMetrics>({
    queryKey: ["memory-metrics"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/memory/metrics");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: recentMemories, isLoading: memoriesLoading } = useQuery<RecentMemory[]>({
    queryKey: ["memory-recent"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/memory/recent?limit=30");
      return res.json();
    },
  });

  const { data: decisions, isLoading: decisionsLoading } = useQuery<DecisionMemory[]>({
    queryKey: ["memory-decisions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/memory/decisions?limit=50");
      return res.json();
    },
  });

  const { data: entities, isLoading: entitiesLoading } = useQuery<EntityRow[]>({
    queryKey: ["memory-entities"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/memory/entities?limit=100");
      return res.json();
    },
  });

  const totalVectors = status?.qdrant.totalVectors ?? 0;
  const entityCount = entities?.length ?? 0;
  const decisionCount = decisions?.length ?? 0;
  const memoryCount = recentMemories?.length ?? 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            Memory
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            4-layer hybrid memory system — Qdrant · Pinecone · FalkorDB · Postgres
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/graph")}>
            <Network className="h-4 w-4 mr-1.5" />
            Knowledge Graph
          </Button>
          <Button variant="ghost" size="icon" onClick={() => refetchStatus()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Health Strip */}
      {statusLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      ) : status ? (
        <HealthStrip status={status} />
      ) : null}

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Vectors stored", value: totalVectors.toLocaleString(), icon: Layers, color: "text-blue-400" },
          { label: "Entities tracked", value: entityCount.toLocaleString(), icon: Users, color: "text-purple-400" },
          { label: "Decisions logged", value: decisionCount.toLocaleString(), icon: GitBranch, color: "text-green-400" },
          { label: "Recent memories", value: memoryCount.toLocaleString(), icon: Database, color: "text-orange-400" },
        ].map((stat) => (
          <Card key={stat.label} className="bg-card/60">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold mt-0.5">{stat.value}</p>
                </div>
                <stat.icon className={cn("h-5 w-5", stat.color)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Retrieval Arm Metrics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Retrieval Arm Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MetricsPanel metrics={metrics} />
        </CardContent>
      </Card>

      {/* Main Tabs */}
      <Tabs defaultValue="memories">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="memories">
            <Database className="h-3.5 w-3.5 mr-1.5" />
            Memories
          </TabsTrigger>
          <TabsTrigger value="decisions">
            <GitBranch className="h-3.5 w-3.5 mr-1.5" />
            Decisions
          </TabsTrigger>
          <TabsTrigger value="entities">
            <Users className="h-3.5 w-3.5 mr-1.5" />
            Entities
          </TabsTrigger>
          <TabsTrigger value="search">
            <Search className="h-3.5 w-3.5 mr-1.5" />
            Search
          </TabsTrigger>
        </TabsList>

        <TabsContent value="memories" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Recent Agent Memories</CardTitle>
            </CardHeader>
            <CardContent>
              {memoriesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
                </div>
              ) : (
                <RecentMemoriesList memories={recentMemories ?? []} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="decisions" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Decision Journal</CardTitle>
            </CardHeader>
            <CardContent>
              {decisionsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
                </div>
              ) : (
                <DecisionJournal decisions={decisions ?? []} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entities" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Entity Browser</span>
                <Button variant="outline" size="sm" onClick={() => navigate("/graph")}>
                  <Network className="h-3.5 w-3.5 mr-1" />
                  View Graph
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {entitiesLoading ? (
                <div className="space-y-1.5">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}
                </div>
              ) : (
                <EntityBrowser entities={entities ?? []} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Search Playground</CardTitle>
              <p className="text-xs text-muted-foreground">
                Runs the full hybrid retriever — vector + keyword + graph RRF fusion.
              </p>
            </CardHeader>
            <CardContent>
              <SearchPlayground />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
