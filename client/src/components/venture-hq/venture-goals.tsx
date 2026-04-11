import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Target,
  Plus,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface KeyResult {
  id: string;
  goalId: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  status: "on_track" | "at_risk" | "behind" | "completed";
  completedAt: string | null;
}

interface VentureGoal {
  id: string;
  ventureId: string;
  period: "monthly" | "quarterly" | "annual";
  periodStart: string;
  periodEnd: string;
  targetStatement: string;
  status: "active" | "completed" | "missed" | "carried_over";
  reviewNotes: string | null;
  keyResults?: KeyResult[];
}

interface StagedPackStatus {
  ventureId: string;
  ventureName: string;
  vision: string | null;
  mission: string | null;
  currentGoalId: string | null;
  activeGoal: VentureGoal | null;
  stagingStatus: "none" | "staged" | "committed";
}

const statusColors: Record<string, string> = {
  on_track: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  at_risk: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  behind: "bg-red-500/20 text-red-400 border-red-500/30",
  completed: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  missed: "bg-red-500/20 text-red-400 border-red-500/30",
  carried_over: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

const StatusIcon = ({ status }: { status: string }) => {
  if (status === "on_track" || status === "completed") return <TrendingUp className="h-3 w-3" />;
  if (status === "behind") return <TrendingDown className="h-3 w-3" />;
  if (status === "at_risk") return <Minus className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
};

function KeyResultRow({
  kr,
  goalId,
  ventureId,
}: {
  kr: KeyResult;
  goalId: string;
  ventureId: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState(String(kr.currentValue));

  const pct = kr.targetValue > 0 ? Math.min(100, (kr.currentValue / kr.targetValue) * 100) : 0;

  const updateProgress = useMutation({
    mutationFn: (value: number) =>
      apiRequest("PATCH", `/api/ventures/key-results/${kr.id}/progress`, { currentValue: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/goals`] });
      setEditing(false);
      toast({ title: "Progress updated" });
    },
  });

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground flex-1 leading-tight">{kr.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="h-6 w-16 text-xs px-1.5"
                type="number"
              />
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => updateProgress.mutate(parseFloat(newValue) || 0)}
                disabled={updateProgress.isPending}
              >
                {updateProgress.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "✓"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1 text-xs"
                onClick={() => { setEditing(false); setNewValue(String(kr.currentValue)); }}
              >
                ✕
              </Button>
            </div>
          ) : (
            <>
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setEditing(true)}
              >
                {kr.currentValue}/{kr.targetValue} {kr.unit}
              </button>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${statusColors[kr.status]}`}>
                <StatusIcon status={kr.status} />
              </Badge>
            </>
          )}
        </div>
      </div>
      <div className="relative">
        <Progress
          value={pct}
          className={`h-1.5 ${kr.status === "completed" ? "[&>div]:bg-blue-500" : kr.status === "behind" ? "[&>div]:bg-red-500" : kr.status === "at_risk" ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
        />
      </div>
    </div>
  );
}

function GoalCard({ goal, ventureId }: { goal: VentureGoal; ventureId: string }) {
  const [expanded, setExpanded] = useState(true);
  const krs = goal.keyResults || [];
  const completedKRs = krs.filter((kr) => kr.status === "completed").length;
  const overallPct =
    krs.length > 0
      ? Math.round(krs.reduce((sum, kr) => sum + (kr.targetValue > 0 ? Math.min(100, (kr.currentValue / kr.targetValue) * 100) : 0), 0) / krs.length)
      : 0;
  const overallStatus =
    krs.every((kr) => kr.status === "completed")
      ? "completed"
      : krs.some((kr) => kr.status === "behind")
      ? "behind"
      : krs.some((kr) => kr.status === "at_risk")
      ? "at_risk"
      : "on_track";

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge variant="outline" className="text-[10px] px-1.5 capitalize">
                {goal.period}
              </Badge>
              <Badge variant="outline" className={`text-[10px] px-1.5 ${statusColors[overallStatus]}`}>
                <StatusIcon status={overallStatus} />
                <span className="ml-1 capitalize">{overallStatus.replace("_", " ")}</span>
              </Badge>
              {krs.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {completedKRs}/{krs.length} KRs done
                </span>
              )}
            </div>
            <p className="text-sm font-medium leading-snug">{goal.targetStatement}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {goal.periodStart} → {goal.periodEnd}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums leading-none">{overallPct}%</div>
              <div className="text-[10px] text-muted-foreground">overall</div>
            </div>
            <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {krs.length > 0 && (
          <Progress
            value={overallPct}
            className={`h-2 mt-2 ${overallStatus === "completed" ? "[&>div]:bg-blue-500" : overallStatus === "behind" ? "[&>div]:bg-red-500" : overallStatus === "at_risk" ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500"}`}
          />
        )}
      </CardHeader>

      {expanded && krs.length > 0 && (
        <CardContent className="pt-0 space-y-3">
          <div className="h-px bg-border/50" />
          {krs.map((kr) => (
            <KeyResultRow key={kr.id} kr={kr} goalId={goal.id} ventureId={ventureId} />
          ))}
        </CardContent>
      )}

      {expanded && krs.length === 0 && (
        <CardContent className="pt-0">
          <p className="text-xs text-muted-foreground italic">No key results yet.</p>
        </CardContent>
      )}
    </Card>
  );
}

function NewGoalDialog({ ventureId }: { ventureId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    period: "quarterly" as "monthly" | "quarterly" | "annual",
    periodStart: "",
    periodEnd: "",
    targetStatement: "",
  });
  const [krs, setKrs] = useState([{ title: "", targetValue: "", unit: "" }]);

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/ventures/${ventureId}/goals`, {
        ...form,
        keyResults: krs
          .filter((kr) => kr.title && kr.targetValue)
          .map((kr) => ({ ...kr, targetValue: parseFloat(kr.targetValue) })),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/goals`] });
      setOpen(false);
      toast({ title: "Goal created" });
    },
    onError: () => toast({ title: "Failed to create goal", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-2" />
          New Goal
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Venture Goal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Period</Label>
              <Select value={form.period} onValueChange={(v: any) => setForm({ ...form, period: v })}>
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Start</Label>
              <Input
                type="date"
                className="h-8 text-xs mt-1"
                value={form.periodStart}
                onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">End</Label>
              <Input
                type="date"
                className="h-8 text-xs mt-1"
                value={form.periodEnd}
                onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Target Statement</Label>
            <Textarea
              className="mt-1 text-sm resize-none"
              rows={2}
              placeholder="What does success look like this period?"
              value={form.targetStatement}
              onChange={(e) => setForm({ ...form, targetStatement: e.target.value })}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Key Results</Label>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => setKrs([...krs, { title: "", targetValue: "", unit: "" }])}
              >
                + Add KR
              </button>
            </div>
            <div className="space-y-2">
              {krs.map((kr, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_60px] gap-1.5">
                  <Input
                    className="h-7 text-xs"
                    placeholder="Measurable outcome"
                    value={kr.title}
                    onChange={(e) => {
                      const next = [...krs];
                      next[i] = { ...next[i], title: e.target.value };
                      setKrs(next);
                    }}
                  />
                  <Input
                    className="h-7 text-xs"
                    type="number"
                    placeholder="Target"
                    value={kr.targetValue}
                    onChange={(e) => {
                      const next = [...krs];
                      next[i] = { ...next[i], targetValue: e.target.value };
                      setKrs(next);
                    }}
                  />
                  <Input
                    className="h-7 text-xs"
                    placeholder="unit"
                    value={kr.unit}
                    onChange={(e) => {
                      const next = [...krs];
                      next[i] = { ...next[i], unit: e.target.value };
                      setKrs(next);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.targetStatement || !form.periodStart || !form.periodEnd}
          >
            {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" />}
            Create Goal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VenturePackBanner({ ventureId }: { ventureId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [staging, setStaging] = useState(false);

  const { data: packStatus } = useQuery<StagedPackStatus>({
    queryKey: [`/api/ventures/${ventureId}/staged-pack`],
    queryFn: async () => {
      const res = await fetch(`/api/ventures/${ventureId}/staged-pack`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const stage = async () => {
    setStaging(true);
    try {
      const res = await fetch(`/api/ventures/${ventureId}/stage-pack`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error();
      const pack = await res.json();
      toast({
        title: "Venture pack staged",
        description: `Review docs in Google Drive then come back to approve.`,
      });
      qc.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/staged-pack`] });
    } catch {
      toast({ title: "Failed to stage venture pack", variant: "destructive" });
    } finally {
      setStaging(false);
    }
  };

  if (packStatus?.stagingStatus === "committed" || (packStatus?.activeGoal)) return null;

  return (
    <Card className="border-dashed border-amber-500/40 bg-amber-500/5">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">No goals set for this venture</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Generate a full venture pack in Google Drive — one-pager, goals & KRs, project plan, ops vault — then approve it here.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            onClick={stage}
            disabled={staging}
          >
            {staging ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            {staging ? "Generating..." : "Generate Pack"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VentureGoals({ ventureId }: { ventureId: string }) {
  const { data: goals = [], isLoading } = useQuery<VentureGoal[]>({
    queryKey: [`/api/ventures/${ventureId}/goals`],
    queryFn: async () => {
      const res = await fetch(`/api/ventures/${ventureId}/goals`, { credentials: "include" });
      if (!res.ok) throw new Error();
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-32 bg-muted animate-pulse rounded-lg" />
        <div className="h-24 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  const activeGoals = goals.filter((g) => g.status === "active");
  const pastGoals = goals.filter((g) => g.status !== "active");

  return (
    <div className="space-y-4">
      <VenturePackBanner ventureId={ventureId} />

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Goals & Key Results</h3>
          <p className="text-xs text-muted-foreground">
            {activeGoals.length} active · {pastGoals.length} past
          </p>
        </div>
        <NewGoalDialog ventureId={ventureId} />
      </div>

      {activeGoals.length === 0 && pastGoals.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-medium mb-1">No goals yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Set a quarterly goal with measurable key results to track progress.
            </p>
            <NewGoalDialog ventureId={ventureId} />
          </CardContent>
        </Card>
      )}

      {activeGoals.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active</h4>
          {activeGoals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} ventureId={ventureId} />
          ))}
        </div>
      )}

      {pastGoals.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Past</h4>
          {pastGoals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} ventureId={ventureId} />
          ))}
        </div>
      )}
    </div>
  );
}
