import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Plus, Trash2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────

interface ApprovalPolicy {
  id: string;
  agentSlug: string;
  deliverableType: string;
  ventureId: string | null;
  maxCostUSD: number | null;
  reason: string | null;
  autoApprove: boolean;
  active: boolean;
  createdAt: string;
}

interface PolicyFormState {
  agentSlug: string;
  deliverableType: string;
  maxCostUSD: string;
  reason: string;
  autoApprove: boolean;
}

const DELIVERABLE_TYPES = [
  { value: "research", label: "Research" },
  { value: "social_post", label: "Social Post" },
  { value: "video_script", label: "Video Script" },
  { value: "document", label: "Document" },
  { value: "code", label: "Code" },
  { value: "other", label: "Other" },
];

const DELIVERABLE_COLORS: Record<string, string> = {
  research: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  social_post: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  video_script: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  document: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  code: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  other: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
};

const EMPTY_FORM: PolicyFormState = {
  agentSlug: "",
  deliverableType: "",
  maxCostUSD: "",
  reason: "",
  autoApprove: true,
};

// ── Main Component ──────────────────────────────────────

export function ApprovalPoliciesManager() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PolicyFormState>(EMPTY_FORM);

  // ── Fetch ──────────────────────────────────────────────

  const { data: policies = [], isLoading } = useQuery<ApprovalPolicy[]>({
    queryKey: ["/api/approval-policies"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/approval-policies");
      return res.json();
    },
  });

  // ── Create ─────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: async (payload: Omit<PolicyFormState, "maxCostUSD"> & { maxCostUSD: number | null }) => {
      const res = await apiRequest("POST", "/api/approval-policies", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      toast({ title: "Policy created", description: "Auto-approve rule saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create policy", description: err.message, variant: "destructive" });
    },
  });

  // ── Toggle active ──────────────────────────────────────

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const res = await apiRequest("PATCH", `/api/approval-policies/${id}`, { active });
      return res.json();
    },
    onMutate: async ({ id, active }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: ["/api/approval-policies"] });
      const previous = queryClient.getQueryData<ApprovalPolicy[]>(["/api/approval-policies"]);
      queryClient.setQueryData<ApprovalPolicy[]>(["/api/approval-policies"], (old = []) =>
        old.map((p) => (p.id === id ? { ...p, active } : p))
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/approval-policies"], context.previous);
      }
      toast({ title: "Failed to update policy", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
    },
  });

  // ── Delete ─────────────────────────────────────────────

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/approval-policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approval-policies"] });
      toast({ title: "Policy removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete policy", description: err.message, variant: "destructive" });
    },
  });

  // ── Submit handler ─────────────────────────────────────

  function handleSubmit() {
    if (!form.agentSlug.trim() || !form.deliverableType) {
      toast({ title: "Agent slug and deliverable type are required.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      agentSlug: form.agentSlug.trim(),
      deliverableType: form.deliverableType,
      maxCostUSD: form.maxCostUSD ? parseFloat(form.maxCostUSD) : null,
      reason: form.reason.trim(),
      autoApprove: form.autoApprove,
    });
  }

  // ── Render ─────────────────────────────────────────────

  return (
    <Card className="border border-border/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            Agent Policies
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[12px] gap-1.5"
            onClick={() => { setForm(EMPTY_FORM); setDialogOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add Policy
          </Button>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : policies.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 mb-3">
              <AlertCircle className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-[12px] text-muted-foreground max-w-[280px] leading-relaxed">
              No auto-approve policies yet. Add one to skip the review queue for low-risk deliverables.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_1fr_80px_48px_40px] gap-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              <span>Agent</span>
              <span>Type</span>
              <span>Max cost</span>
              <span>Active</span>
              <span />
            </div>

            {policies.map((policy) => (
              <div
                key={policy.id}
                className={`grid grid-cols-[1fr_1fr_80px_48px_40px] gap-2 items-center rounded-md px-2.5 py-2.5 border transition-colors ${
                  policy.active
                    ? "border-border/30 bg-muted/10 hover:bg-muted/20"
                    : "border-border/20 bg-muted/5 opacity-50"
                }`}
              >
                {/* Agent slug */}
                <span className="font-mono text-[11px] text-foreground/80 truncate">
                  @{policy.agentSlug}
                </span>

                {/* Deliverable type */}
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 w-fit border-0 ${DELIVERABLE_COLORS[policy.deliverableType] || DELIVERABLE_COLORS.other}`}
                >
                  {(policy.deliverableType || "").replace("_", " ")}
                </Badge>

                {/* Max cost */}
                <span className="text-[11px] text-muted-foreground">
                  {policy.maxCostUSD != null ? `$${policy.maxCostUSD.toFixed(2)}` : "No limit"}
                </span>

                {/* Active toggle */}
                <Switch
                  checked={policy.active}
                  onCheckedChange={(checked) =>
                    toggleMutation.mutate({ id: policy.id, active: checked })
                  }
                  className="scale-75 origin-left"
                  disabled={toggleMutation.isPending}
                />

                {/* Delete */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10"
                  onClick={() => deleteMutation.mutate(policy.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* ── Add Policy Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              New Auto-Approve Policy
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Agent Slug */}
            <div className="space-y-1.5">
              <Label htmlFor="agentSlug" className="text-[12px]">
                Agent Slug <span className="text-red-500">*</span>
              </Label>
              <Input
                id="agentSlug"
                placeholder="e.g. script-writer-syntheliq"
                value={form.agentSlug}
                onChange={(e) => setForm((f) => ({ ...f, agentSlug: e.target.value }))}
                className="h-8 text-[13px]"
              />
            </div>

            {/* Deliverable Type */}
            <div className="space-y-1.5">
              <Label htmlFor="deliverableType" className="text-[12px]">
                Deliverable Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={form.deliverableType}
                onValueChange={(val) => setForm((f) => ({ ...f, deliverableType: val }))}
              >
                <SelectTrigger id="deliverableType" className="h-8 text-[13px]">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERABLE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-[13px]">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Max Cost */}
            <div className="space-y-1.5">
              <Label htmlFor="maxCostUSD" className="text-[12px]">
                Max Cost (USD)
              </Label>
              <Input
                id="maxCostUSD"
                type="number"
                min="0"
                step="0.01"
                placeholder="No limit"
                value={form.maxCostUSD}
                onChange={(e) => setForm((f) => ({ ...f, maxCostUSD: e.target.value }))}
                className="h-8 text-[13px]"
              />
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-[12px]">
                Reason
              </Label>
              <Input
                id="reason"
                placeholder="e.g. Internal research is always safe"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                className="h-8 text-[13px]"
              />
            </div>

            {/* Auto Approve toggle */}
            <div className="flex items-center justify-between rounded-md border border-border/30 bg-muted/20 px-3 py-2.5">
              <div>
                <p className="text-[13px] font-medium">Auto Approve</p>
                <p className="text-[11px] text-muted-foreground">
                  Bypass review queue automatically
                </p>
              </div>
              <Switch
                checked={form.autoApprove}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, autoApprove: checked }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={createMutation.isPending}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {createMutation.isPending ? "Saving…" : "Save Policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
