// Command Center V4 — CEO Dashboard Redesign
// Build version: 2026-04-11-v4
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IntelligenceBriefingWidget } from "@/components/cockpit/intelligence-briefing-widget";
import { EmailTriageWidget } from "@/components/cockpit/email-triage-widget";
import { AgentPulseWidget } from "@/components/cockpit/agent-pulse-widget";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Clock,
  Flame,
  AlertTriangle,
  Target,
  Calendar,
  Video,
  MapPin,
  Sun,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  Circle,
  Inbox,
  BarChart2,
  DollarSign,
  Zap,
  ArrowRight,
} from "lucide-react";
import { useWebSocket } from "@/hooks/use-websocket";

// ── helpers ────────────────────────────────────────────────────────────────

function formatTimeUntil(minutes: number) {
  if (minutes < 60) return `in ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

function pct(current: number, target: number) {
  return target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
}

const KR_COLORS: Record<string, string> = {
  on_track: "[&>div]:bg-emerald-500",
  at_risk: "[&>div]:bg-amber-500",
  behind: "[&>div]:bg-red-500",
  completed: "[&>div]:bg-blue-500",
  no_goal: "[&>div]:bg-muted",
};

// ── widget: Schedule ───────────────────────────────────────────────────────

function ScheduleWidget() {
  const [, navigate] = useLocation();
  const { data: events = [], isLoading } = useQuery<any[]>({
    queryKey: ["calendar-events-today"],
    queryFn: async () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59);
      const res = await fetch(
        `/api/calendar/events?start=${now.toISOString()}&end=${end.toISOString()}&maxResults=6`,
        { credentials: "include" }
      );
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 120000,
  });

  const freeHours = Math.max(0, 8 - events.reduce((sum: number, e: any) => {
    const start = new Date(e.start?.dateTime || e.start?.date);
    const end = new Date(e.end?.dateTime || e.end?.date);
    return sum + (end.getTime() - start.getTime()) / 3600000;
  }, 0));

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5" />
          Today's Schedule
        </CardTitle>
        <span className="text-xs text-muted-foreground">{Math.round(freeHours * 10) / 10}h free</span>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {events.length === 0 ? (
          <div className="text-sm text-muted-foreground py-3 text-center">
            <Calendar className="h-6 w-6 mx-auto mb-1 opacity-40" />
            Clear calendar today
          </div>
        ) : (
          events.slice(0, 5).map((e: any) => {
            const start = new Date(e.start?.dateTime || e.start?.date);
            const timeStr = e.start?.dateTime
              ? start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : "All day";
            const now = new Date();
            const isNext = start > now;
            return (
              <div
                key={e.id}
                className={`flex items-center gap-2.5 p-2 rounded-md text-sm ${isNext ? "bg-muted/30" : "opacity-50"}`}
              >
                <span className="text-xs text-muted-foreground w-12 shrink-0 tabular-nums">{timeStr}</span>
                <span className="flex-1 truncate font-medium leading-tight">{e.summary || "Event"}</span>
                {e.hangoutLink && (
                  <button
                    onClick={() => window.open(e.hangoutLink, "_blank")}
                    className="text-purple-400 hover:text-purple-300 transition-colors shrink-0"
                  >
                    <Video className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
        <button
          onClick={() => navigate("/calendar")}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 pt-1"
        >
          Full calendar <ChevronRight className="h-3 w-3" />
        </button>
      </CardContent>
    </Card>
  );
}

// ── widget: Inbox ──────────────────────────────────────────────────────────

function InboxWidget() {
  const [, navigate] = useLocation();
  const { data: inbox = { items: [], total: 0 }, isLoading } = useQuery<any>({
    queryKey: ["dashboard-inbox"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/inbox", { credentials: "include" });
      if (!res.ok) return { items: [], total: 0 };
      return res.json();
    },
    refetchInterval: 60000,
  });

  const count = inbox.total || inbox.items?.length || 0;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Inbox className="h-3.5 w-3.5" />
          Inbox
        </CardTitle>
        {count > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 h-4 bg-amber-500/20 text-amber-400 border-amber-500/30">
            {count} to process
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : count === 0 ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Inbox zero
          </div>
        ) : (
          <div className="space-y-1.5">
            {inbox.items?.slice(0, 3).map((item: any) => (
              <div key={item.id} className="text-sm flex items-center gap-2 p-1.5 rounded hover:bg-muted/40 transition-colors">
                <Circle className="h-2.5 w-2.5 text-amber-400 shrink-0" />
                <span className="truncate text-sm leading-tight">{item.title}</span>
              </div>
            ))}
            {count > 3 && (
              <p className="text-xs text-muted-foreground pl-1">+{count - 3} more</p>
            )}
          </div>
        )}
        <button
          onClick={() => navigate("/capture")}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-2"
        >
          Process inbox <ChevronRight className="h-3 w-3" />
        </button>
      </CardContent>
    </Card>
  );
}

// ── widget: Weekly Pulse ───────────────────────────────────────────────────

function WeeklyPulseWidget() {
  const [, navigate] = useLocation();

  const { data: week } = useQuery<any>({
    queryKey: ["weeks-current"],
    queryFn: async () => {
      const res = await fetch("/api/weeks/current", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: history = [] } = useQuery<Array<{ date: string; score: number }>>({
    queryKey: ["scorecard-history"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/scorecard-history?days=7", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const big3 = week?.big3 || [];
  const maxScore = Math.max(...history.map((h) => h.score), 1);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <BarChart2 className="h-3.5 w-3.5" />
          Weekly Pulse
        </CardTitle>
        <button onClick={() => navigate("/today")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          Today <ChevronRight className="h-3 w-3" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Sparkline */}
        {history.length > 0 && (
          <div className="flex items-end gap-0.5 h-8">
            {history.map((h, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/40 rounded-sm"
                style={{ height: `${(h.score / maxScore) * 100}%` }}
                title={`${h.date}: ${h.score}`}
              />
            ))}
          </div>
        )}

        {/* Big 3 */}
        {big3.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Big 3 this week</p>
            {big3.slice(0, 3).map((item: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="text-xs text-muted-foreground w-4 shrink-0 tabular-nums">{i + 1}.</span>
                <span className={`flex-1 leading-tight ${item.done ? "line-through text-muted-foreground" : ""}`}>{item.text || item.title}</span>
                {item.done && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No weekly targets set.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── widget: Tasks ──────────────────────────────────────────────────────────

function TasksWidget() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: top3Data = { tasks: [] }, isLoading } = useQuery<any>({
    queryKey: ["dashboard-top3"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/top3", { credentials: "include" });
      if (!res.ok) throw new Error();
      return res.json();
    },
  });

  const { data: dayData } = useQuery<any>({
    queryKey: ["dashboard-day"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/day", { credentials: "include" });
      if (!res.ok) throw new Error();
      return res.json();
    },
  });

  const completeTask = useMutation({
    mutationFn: async (taskId: string) => {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard-top3"] });
    },
  });

  const oneThingToShip = dayData?.oneThingToShip;
  const tasks: any[] = top3Data.tasks || [];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Target className="h-3.5 w-3.5" />
            My Tasks
          </CardTitle>
          {oneThingToShip && (
            <p className="text-[10px] text-amber-400 mt-0.5 flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {oneThingToShip}
            </p>
          )}
        </div>
        <button onClick={() => navigate("/tasks")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          All tasks <ChevronRight className="h-3 w-3" />
        </button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
            All clear — no urgent tasks
          </div>
        ) : (
          tasks.map((t: any, idx: number) => (
            <div
              key={t.id}
              className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors group"
            >
              <button
                onClick={() => completeTask.mutate(t.id)}
                className="h-5 w-5 rounded-full border-2 border-border hover:border-emerald-500 hover:bg-emerald-500/20 transition-colors flex items-center justify-center flex-shrink-0 mt-0.5"
              >
                <span className="h-2 w-2 rounded-full bg-transparent group-hover:bg-emerald-500 transition-colors" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm leading-tight">{t.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span className={t.priority === "P0" ? "text-red-400" : t.priority === "P1" ? "text-orange-400" : ""}>{t.priority}</span>
                  {t.ventureName && <span className="truncate">· {t.ventureName}</span>}
                  {t.isOverdue && <span className="text-red-400 font-medium">OVERDUE</span>}
                  {t.isDueToday && !t.isOverdue && <span className="text-amber-400 font-medium">Due today</span>}
                </div>
              </div>
              <span className="text-xs text-muted-foreground w-4 tabular-nums">{idx + 1}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ── widget: Venture Pulse ──────────────────────────────────────────────────

function VenturePulseWidget() {
  const [, navigate] = useLocation();

  const { data: ventures = [], isLoading } = useQuery<any[]>({
    queryKey: ["dashboard-ventures-v2"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/ventures-v2", { credentials: "include" });
      if (!res.ok) throw new Error();
      return res.json();
    },
    refetchInterval: 120000,
  });

  const statusIcon = (status: string) => {
    if (status === "on_track" || status === "completed") return <TrendingUp className="h-3 w-3 text-emerald-400" />;
    if (status === "behind") return <TrendingDown className="h-3 w-3 text-red-400" />;
    if (status === "at_risk") return <Minus className="h-3 w-3 text-amber-400" />;
    return null;
  };

  const statusBadge: Record<string, string> = {
    on_track: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    at_risk: "bg-amber-500/15 text-amber-400 border-amber-500/25",
    behind: "bg-red-500/15 text-red-400 border-red-500/25",
    completed: "bg-blue-500/15 text-blue-400 border-blue-500/25",
    no_goal: "bg-muted/50 text-muted-foreground border-border",
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Zap className="h-3.5 w-3.5" />
          Venture Pulse
        </CardTitle>
        <button onClick={() => navigate("/ventures")} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
          All ventures <ChevronRight className="h-3 w-3" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : ventures.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No active ventures</p>
        ) : (
          ventures.map((v: any) => (
            <button
              key={v.id}
              onClick={() => navigate(`/ventures/${v.slug || v.id}`)}
              className="w-full text-left p-2.5 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors space-y-2 group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: v.color || "#6366f1" }}
                    />
                    <span className="font-medium text-sm leading-tight truncate">{v.name}</span>
                  </div>
                  {v.activeGoal ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight line-clamp-1 pl-3.5">
                      {v.activeGoal.targetStatement}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-0.5 pl-3.5 italic">No goal set</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {statusIcon(v.overallStatus)}
                  <Badge variant="outline" className={`text-[10px] px-1.5 h-4 ${statusBadge[v.overallStatus] || statusBadge.no_goal}`}>
                    {v.progressPercent}%
                  </Badge>
                  <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              {v.activeGoal && v.keyResults?.length > 0 && (
                <Progress
                  value={v.progressPercent}
                  className={`h-1 ${KR_COLORS[v.overallStatus] || "[&>div]:bg-muted"}`}
                />
              )}
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ── widget: Financials ─────────────────────────────────────────────────────

function FinancialsWidget() {
  const { data: fin } = useQuery<any>({
    queryKey: ["dashboard-financials"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/financials", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <DollarSign className="h-3.5 w-3.5" />
          Financials
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!fin ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded-md bg-muted/20">
              <p className="text-[10px] text-muted-foreground">Revenue</p>
              <p className="text-base font-bold tabular-nums text-emerald-400">AED {fmt(fin.totalRevenue)}</p>
            </div>
            <div className="p-2 rounded-md bg-muted/20">
              <p className="text-[10px] text-muted-foreground">Spent</p>
              <p className="text-base font-bold tabular-nums">{fmt(fin.totalSpent)}</p>
            </div>
            <div className="p-2 rounded-md bg-muted/20">
              <p className="text-[10px] text-muted-foreground">Budget</p>
              <p className="text-base font-bold tabular-nums">{fmt(fin.totalBudget)}</p>
            </div>
            <div className={`p-2 rounded-md ${fin.netPosition >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
              <p className="text-[10px] text-muted-foreground">Net</p>
              <p className={`text-base font-bold tabular-nums ${fin.netPosition >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {fin.netPosition >= 0 ? "+" : ""}{fmt(fin.netPosition)}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── main: Command Center V4 ────────────────────────────────────────────────

export default function CommandCenterV2() {
  const [, navigate] = useLocation();
  const [time, setTime] = useState(new Date());
  const { connected: wsConnected } = useWebSocket();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Queries
  const { data: readiness } = useQuery<any>({
    queryKey: ["dashboard-readiness"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/readiness", { credentials: "include" });
      if (!res.ok) throw new Error();
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: urgent = { onFire: false, totalUrgent: 0, tasks: [] } } = useQuery<any>({
    queryKey: ["dashboard-urgent"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/urgent", { credentials: "include" });
      if (!res.ok) throw new Error();
      return res.json();
    },
  });

  const { data: nextMeeting = { configured: false, meeting: null } } = useQuery<any>({
    queryKey: ["dashboard-next-meeting"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/next-meeting", { credentials: "include" });
      if (!res.ok) throw new Error();
      return res.json();
    },
    refetchInterval: 60000,
  });

  const hour = time.getHours();
  const mode =
    hour >= 5 && hour < 9 ? "morning" :
    hour >= 9 && hour < 12 ? "deep_work" :
    hour >= 12 && hour < 14 ? "admin" :
    hour >= 14 && hour < 17 ? "trading" :
    hour >= 17 && hour < 20 ? "admin" : "shutdown";

  const needsHealthLog = readiness?.status === "no_data";
  const readinessPct = readiness?.percentage || 0;
  const readinessColor = readinessPct >= 70 ? "text-emerald-400" : readinessPct >= 40 ? "text-amber-400" : "text-red-400";

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-screen-xl mx-auto">
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="px-4 md:px-6 py-4 border-b border-border/40 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Command Center
            <span className="text-xs text-muted-foreground font-normal ml-2">v4</span>
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <Clock className="h-3 w-3" />
            <span className="tabular-nums">{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span>·</span>
            <span className="uppercase font-semibold tracking-wider">{mode.replace("_", " ")}</span>
            {wsConnected && (
              <>
                <span>·</span>
                <span className="text-emerald-500 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  LIVE
                </span>
              </>
            )}
            {urgent.totalUrgent > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {urgent.totalUrgent} urgent
                </span>
              </>
            )}
          </div>
        </div>

        {/* Readiness ring */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className={`text-2xl font-bold tabular-nums leading-none ${readinessColor}`}>
              {readinessPct}%
            </div>
            <div className="text-[10px] text-muted-foreground">readiness</div>
          </div>
          <div className={`h-3 w-3 rounded-full ${readinessPct >= 70 ? "bg-emerald-500" : readinessPct >= 40 ? "bg-amber-500" : "bg-red-500"} animate-pulse`} />
        </div>
      </header>

      {/* ── ALERT BANNERS ──────────────────────────────────────────────── */}
      <div className="px-4 md:px-6 space-y-2 pt-3">
        {urgent.onFire && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3">
            <Flame className="h-5 w-5 text-red-500 animate-pulse shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-red-400 text-sm">
                {urgent.overdueP0Count > 0
                  ? `${urgent.overdueP0Count} overdue P0 task${urgent.overdueP0Count > 1 ? "s" : ""}`
                  : `${urgent.dueTodayCount} P0 task${urgent.dueTodayCount > 1 ? "s" : ""} due today`}
              </div>
              {urgent.tasks[0] && <div className="text-xs text-muted-foreground truncate">{urgent.tasks[0].title}</div>}
            </div>
            <Button size="sm" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10 shrink-0" onClick={() => navigate("/tasks")}>
              View <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        )}

        {mode === "morning" && needsHealthLog && (
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 flex items-center gap-3">
            <Sun className="h-5 w-5 text-orange-400 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold text-orange-400 text-sm">Log your health to start the day</div>
              <div className="text-xs text-muted-foreground">Track sleep, energy, and mood</div>
            </div>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white shrink-0" onClick={() => navigate("/today")}>
              Log Health
            </Button>
          </div>
        )}

        {nextMeeting.meeting && nextMeeting.meeting.minutesUntil <= 15 && (
          <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 flex items-center gap-3">
            <Calendar className="h-5 w-5 text-purple-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{nextMeeting.meeting.title}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <span className="text-orange-400 font-medium">{formatTimeUntil(nextMeeting.meeting.minutesUntil)}</span>
                {nextMeeting.meeting.location && (
                  <><span>·</span><MapPin className="h-3 w-3" /><span className="truncate">{nextMeeting.meeting.location}</span></>
                )}
              </div>
            </div>
            {nextMeeting.meeting.meetLink && (
              <Button size="sm" variant="outline" className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10 shrink-0" onClick={() => window.open(nextMeeting.meeting.meetLink, "_blank")}>
                <Video className="h-3.5 w-3.5 mr-1" /> Join
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── MAIN GRID: 3 equal columns ─────────────────────────────────── */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 md:p-6 pt-3">

        {/* LEFT: Your Day */}
        <div className="space-y-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground pl-0.5">Your Day</p>
          <ScheduleWidget />
          <InboxWidget />
          <WeeklyPulseWidget />
        </div>

        {/* CENTER: Execution */}
        <div className="space-y-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground pl-0.5">Execution</p>
          <TasksWidget />
          <IntelligenceBriefingWidget />
          <div className="[&_.email-compact]:block">
            <EmailTriageWidget />
          </div>
        </div>

        {/* RIGHT: Business Health */}
        <div className="space-y-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground pl-0.5">Business Health</p>
          <VenturePulseWidget />
          <AgentPulseWidget />
          <FinancialsWidget />
        </div>

      </main>
    </div>
  );
}
