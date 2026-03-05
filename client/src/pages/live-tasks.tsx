import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Activity,
  Bot,
  Clock,
  CheckCircle2,
  Loader2,
  Timer,
  CircleDot,
  Hourglass,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";

interface AgentTask {
  id: string;
  title: string;
  status: string;
  assignedTo: string;
  createdAt: string;
  completedAt: string | null;
  agentName: string;
  agentSlug: string;
  description?: string | null;
}

interface SubAgentRun {
  id: string;
  parentAgentId: string;
  childAgentSlug: string;
  task: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  result?: string | null;
}

interface RunningData {
  agentTasks: AgentTask[];
  subAgentRuns: SubAgentRun[];
  total: number;
}

function elapsed(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PulseIndicator() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
    </span>
  );
}

function RunningTaskCard({ task }: { task: AgentTask }) {
  const [, navigate] = useLocation();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card
      className="cursor-pointer hover:border-green-500/50 transition-colors"
      onClick={() => navigate(`/agents/${task.agentSlug}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <PulseIndicator />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{task.title}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Bot className="h-3 w-3" />
              <span>{task.agentName}</span>
              <Timer className="h-3 w-3 ml-1" />
              <span>{elapsed(task.createdAt)}</span>
            </div>
          </div>
          <Badge variant="outline" className="text-xs bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 shrink-0">
            Running
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function SubAgentCard({ run }: { run: SubAgentRun }) {
  const [, navigate] = useLocation();

  return (
    <Card
      className="cursor-pointer hover:border-blue-500/50 transition-colors"
      onClick={() => navigate(`/agents/${run.childAgentSlug}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <PulseIndicator />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{run.task}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Bot className="h-3 w-3" />
              <span>{run.childAgentSlug}</span>
              <Timer className="h-3 w-3 ml-1" />
              <span>{elapsed(run.startedAt)}</span>
            </div>
          </div>
          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 shrink-0">
            Sub-agent
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function CompletedTaskCard({ task }: { task: AgentTask }) {
  const [, navigate] = useLocation();
  const duration =
    task.completedAt && task.createdAt
      ? elapsed(task.createdAt).replace(
          elapsed(task.createdAt),
          (() => {
            const diff = new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
            const secs = Math.floor(diff / 1000);
            if (secs < 60) return `${secs}s`;
            const mins = Math.floor(secs / 60);
            if (mins < 60) return `${mins}m`;
            const hrs = Math.floor(mins / 60);
            return `${hrs}h ${mins % 60}m`;
          })()
        )
      : null;

  return (
    <Card
      className="cursor-pointer hover:border-muted-foreground/30 transition-colors opacity-80"
      onClick={() => navigate(`/agents/${task.agentSlug}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm truncate">{task.title}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Bot className="h-3 w-3" />
              <span>{task.agentName}</span>
              {duration && (
                <>
                  <Clock className="h-3 w-3 ml-1" />
                  <span>{duration}</span>
                </>
              )}
              <span className="ml-auto">{timeAgo(task.completedAt || task.createdAt)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingTaskCard({ task }: { task: AgentTask }) {
  const [, navigate] = useLocation();

  return (
    <Card
      className="cursor-pointer hover:border-amber-500/50 transition-colors opacity-90"
      onClick={() => navigate(`/agents/${task.agentSlug}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Hourglass className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm truncate">{task.title}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <Bot className="h-3 w-3" />
              <span>{task.agentName}</span>
              <Clock className="h-3 w-3 ml-1" />
              <span>{timeAgo(task.createdAt)}</span>
            </div>
          </div>
          <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 shrink-0">
            Queued
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LiveTasks() {
  // Running tasks (auto-refresh 15s)
  const { data: running, isLoading: loadingRunning } = useQuery<RunningData>({
    queryKey: ["live-tasks-running"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/agents/admin/running");
      return res.json();
    },
    refetchInterval: 15000,
  });

  // Pending/queued tasks
  const { data: pending = [] } = useQuery<AgentTask[]>({
    queryKey: ["live-tasks-pending"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/agents/delegation/log?status=pending&limit=20");
      return res.json();
    },
    refetchInterval: 15000,
  });

  // Recently completed
  const { data: completed = [] } = useQuery<AgentTask[]>({
    queryKey: ["live-tasks-completed"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/agents/delegation/log?status=completed&limit=10");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const runningTasks = running?.agentTasks || [];
  const subAgentRuns = running?.subAgentRuns || [];
  const totalRunning = runningTasks.length + subAgentRuns.length;

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" />
            Live Tasks
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time view of agent activity.
            {totalRunning > 0 && ` ${totalRunning} running now.`}
          </p>
        </div>
        {totalRunning > 0 && (
          <div className="flex items-center gap-2">
            <PulseIndicator />
            <span className="text-sm font-medium text-green-600">{totalRunning} active</span>
          </div>
        )}
      </div>

      <Tabs defaultValue="running">
        <TabsList className="mb-4">
          <TabsTrigger value="running" className="gap-1.5">
            <CircleDot className="h-3.5 w-3.5" />
            Running
            {totalRunning > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {totalRunning}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="queued" className="gap-1.5">
            <Hourglass className="h-3.5 w-3.5" />
            Queued
            {pending.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {pending.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Completed
          </TabsTrigger>
        </TabsList>

        <TabsContent value="running">
          {loadingRunning && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loadingRunning && totalRunning === 0 && (
            <div className="text-center py-16">
              <Activity className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <h3 className="text-base font-medium mb-1">No tasks running</h3>
              <p className="text-muted-foreground text-sm">
                Agent tasks will appear here when they're executing.
              </p>
            </div>
          )}

          <div className="space-y-2">
            {runningTasks.map((task) => (
              <RunningTaskCard key={task.id} task={task} />
            ))}
            {subAgentRuns.map((run) => (
              <SubAgentCard key={run.id} run={run} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="queued">
          {pending.length === 0 ? (
            <div className="text-center py-16">
              <Hourglass className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <h3 className="text-base font-medium mb-1">No queued tasks</h3>
              <p className="text-muted-foreground text-sm">
                Pending agent tasks will show here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {pending.map((task) => (
                <PendingTaskCard
                  key={task.id}
                  task={{
                    ...task,
                    agentName: (task as any).agentName || "Agent",
                    agentSlug: (task as any).agentSlug || "unknown",
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed">
          {completed.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle2 className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
              <h3 className="text-base font-medium mb-1">No recent completions</h3>
              <p className="text-muted-foreground text-sm">
                Completed tasks will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {completed.map((task) => (
                <CompletedTaskCard
                  key={task.id}
                  task={{
                    ...task,
                    agentName: (task as any).agentName || "Agent",
                    agentSlug: (task as any).agentSlug || "unknown",
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
