import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Circle, MinusCircle, AlertCircle,
  Bot, Loader2, ListChecks, Plus, ChevronDown, ChevronUp, Wand2
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient as globalQc } from "@/lib/queryClient";

interface ReadinessItem {
  id: string;
  ventureId: string;
  category: number;
  categoryName: string;
  item: string;
  tier: 'mvp' | 'soft' | 'full';
  status: 'done' | 'partial' | 'missing' | 'na';
  agentReady: boolean;
  notes: string | null;
  updatedAt: string;
}

interface ReadinessData {
  ventureId: string;
  score: number;
  currentTier: string;
  items: ReadinessItem[];
}

const STATUS_CONFIG = {
  done: { icon: CheckCircle2, label: "Done", color: "text-green-500", bg: "bg-green-50 dark:bg-green-900/20" },
  partial: { icon: AlertCircle, label: "Partial", color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-900/20" },
  missing: { icon: Circle, label: "Missing", color: "text-red-500", bg: "bg-red-50 dark:bg-red-900/20" },
  na: { icon: MinusCircle, label: "N/A", color: "text-muted-foreground", bg: "" },
};

const TIER_LABELS: Record<string, string> = {
  'pre-mvp': 'Pre-MVP',
  mvp: 'MVP Ready',
  soft: 'Soft Launch',
  full: 'Full Launch',
};

const TIER_COLORS: Record<string, string> = {
  'pre-mvp': 'bg-slate-500',
  mvp: 'bg-amber-500',
  soft: 'bg-blue-500',
  full: 'bg-green-500',
};

interface Props {
  ventureId: string;
  ventureName: string;
}

async function fetchReadiness(ventureId: string): Promise<ReadinessData> {
  const res = await apiRequest("GET", `/api/ventures/${ventureId}/launch-readiness`);
  return res.json();
}

export default function LaunchReadinessTab({ ventureId, ventureName }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedTiers, setExpandedTiers] = useState<Record<string, boolean>>({ mvp: true, soft: true, full: false });
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState("");

  const { data, isLoading } = useQuery<ReadinessData>({
    queryKey: [`launch-readiness-${ventureId}`],
    queryFn: () => fetchReadiness(ventureId),
  });

  const auditMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ventures/${ventureId}/launch-readiness/run-audit`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`launch-readiness-${ventureId}`] });
      toast({ title: "Audit complete", description: "Launch readiness updated." });
    },
    onError: () => toast({ title: "Audit failed", variant: "destructive" }),
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, updates }: { itemId: string; updates: Partial<Pick<ReadinessItem, 'status' | 'agentReady' | 'notes'>> }) => {
      const res = await apiRequest("PATCH", `/api/ventures/${ventureId}/launch-readiness/${itemId}`, updates);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`launch-readiness-${ventureId}`] }),
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const createTasksMutation = useMutation({
    mutationFn: async () => {
      const missing = (data?.items || []).filter((i: ReadinessItem) => i.status === 'missing');
      await Promise.all(missing.map((item: ReadinessItem) =>
        apiRequest("POST", '/api/tasks', {
          title: item.item,
          status: 'backlog',
          type: 'business',
          ventureId,
          tags: `launch-readiness,${item.tier},${item.agentReady ? 'agent-ready' : 'human-required'}`,
          notes: `Launch Readiness Category: ${item.categoryName} | Tier: ${item.tier.toUpperCase()}`,
        })
      ));
      return missing.length;
    },
    onSuccess: (count: number) => toast({ title: `${count} tasks created`, description: "Missing items added to backlog." }),
    onError: () => toast({ title: "Failed to create tasks", variant: "destructive" }),
  });

  const cycleStatus = (item: ReadinessItem) => {
    const order: ReadinessItem['status'][] = ['missing', 'partial', 'done', 'na'];
    const current = order.indexOf(item.status);
    const next = order[(current + 1) % order.length];
    updateItemMutation.mutate({ itemId: item.id, updates: { status: next } });
  };

  const saveNotes = (itemId: string) => {
    updateItemMutation.mutate({ itemId, updates: { notes: notesValue } });
    setEditingNotes(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const items: ReadinessItem[] = data?.items || [];
  const score = data?.score || 0;
  const currentTier = data?.currentTier || 'pre-mvp';

  const itemsByTier = {
    mvp: items.filter(i => i.tier === 'mvp'),
    soft: items.filter(i => i.tier === 'soft'),
    full: items.filter(i => i.tier === 'full'),
  };

  const tierProgress = (tier: 'mvp' | 'soft' | 'full') => {
    const tierItems = itemsByTier[tier].filter(i => i.status !== 'na');
    if (tierItems.length === 0) return 0;
    const done = tierItems.filter(i => i.status === 'done').length;
    const partial = tierItems.filter(i => i.status === 'partial').length;
    return Math.round(((done + partial * 0.5) / tierItems.length) * 100);
  };

  const missingCount = items.filter(i => i.status === 'missing').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="text-4xl font-bold">{score}</div>
                <div className="text-muted-foreground text-sm">/100</div>
                <Badge className={`${TIER_COLORS[currentTier] || 'bg-slate-500'} text-white ml-2`}>
                  {TIER_LABELS[currentTier] || currentTier}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">{ventureName} — Launch Readiness</div>
              <Progress value={score} className="h-2 w-64" />
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {items.length === 0 && (
                <Button onClick={() => auditMutation.mutate()} disabled={auditMutation.isPending}>
                  {auditMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                  Run AI Audit
                </Button>
              )}
              {items.length > 0 && (
                <>
                  <Button variant="outline" size="sm" onClick={() => auditMutation.mutate()} disabled={auditMutation.isPending}>
                    {auditMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Wand2 className="mr-2 h-3 w-3" />}
                    Re-audit
                  </Button>
                  {missingCount > 0 && (
                    <Button variant="outline" size="sm" onClick={() => createTasksMutation.mutate()} disabled={createTasksMutation.isPending}>
                      {createTasksMutation.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Plus className="mr-2 h-3 w-3" />}
                      Create Tasks ({missingCount})
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {items.length > 0 && (
            <div className="mt-6 grid grid-cols-3 gap-4">
              {(['mvp', 'soft', 'full'] as const).map(tier => (
                <div key={tier} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{tier === 'mvp' ? 'MVP' : tier === 'soft' ? 'Soft Launch' : 'Full Launch'}</span>
                    <span className="text-muted-foreground">{tierProgress(tier)}%</span>
                  </div>
                  <Progress value={tierProgress(tier)} className="h-1.5" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <ListChecks className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-2">No readiness data yet</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Run an AI audit to evaluate {ventureName} against the 10-category launch checklist.
            </p>
            <Button onClick={() => auditMutation.mutate()} disabled={auditMutation.isPending}>
              {auditMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Run AI Audit
            </Button>
          </CardContent>
        </Card>
      ) : (
        (['mvp', 'soft', 'full'] as const).map(tier => (
          <Card key={tier}>
            <CardHeader
              className="pb-2 cursor-pointer"
              onClick={() => setExpandedTiers(p => ({ ...p, [tier]: !p[tier] }))}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {tier === 'mvp' ? 'MVP' : tier === 'soft' ? 'SOFT LAUNCH' : 'FULL LAUNCH'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {itemsByTier[tier].filter(i => i.status === 'done').length}/{itemsByTier[tier].filter(i => i.status !== 'na').length} complete
                  </span>
                </CardTitle>
                {expandedTiers[tier] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>

            {expandedTiers[tier] && (
              <CardContent className="pt-0">
                <div className="divide-y">
                  {itemsByTier[tier].map((item: ReadinessItem) => {
                    const cfg = STATUS_CONFIG[item.status];
                    const StatusIcon = cfg.icon;
                    return (
                      <div key={item.id} className={`py-3 px-2 rounded-sm transition-colors ${cfg.bg}`}>
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => cycleStatus(item)}
                            className={`mt-0.5 flex-shrink-0 ${cfg.color} hover:opacity-70 transition-opacity`}
                            title="Click to cycle status"
                          >
                            <StatusIcon className="h-5 w-5" />
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-sm ${item.status === 'na' ? 'text-muted-foreground line-through' : ''}`}>
                                {item.item}
                              </span>
                              <span className="text-xs text-muted-foreground">· {item.categoryName}</span>
                            </div>
                            {editingNotes === item.id ? (
                              <div className="flex gap-2 mt-1">
                                <Input
                                  value={notesValue}
                                  onChange={e => setNotesValue(e.target.value)}
                                  placeholder="Add notes..."
                                  className="h-7 text-xs"
                                  onKeyDown={e => e.key === 'Enter' && saveNotes(item.id)}
                                  autoFocus
                                />
                                <Button size="sm" className="h-7 text-xs" onClick={() => saveNotes(item.id)}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingNotes(null)}>Cancel</Button>
                              </div>
                            ) : item.notes ? (
                              <div
                                className="text-xs text-muted-foreground mt-0.5 cursor-pointer hover:text-foreground"
                                onClick={() => { setEditingNotes(item.id); setNotesValue(item.notes || ""); }}
                              >
                                {item.notes}
                              </div>
                            ) : (
                              <button
                                className="text-xs text-muted-foreground mt-0.5 hover:text-foreground"
                                onClick={() => { setEditingNotes(item.id); setNotesValue(""); }}
                              >
                                + add note
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            {item.agentReady && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <Bot className="h-3 w-3" /> Agent
                              </Badge>
                            )}
                            <Switch
                              checked={item.agentReady}
                              onCheckedChange={(checked) =>
                                updateItemMutation.mutate({ itemId: item.id, updates: { agentReady: checked } })
                              }
                              title="Agent ready"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
