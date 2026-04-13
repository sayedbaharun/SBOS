import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Lock, Unlock, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface KeyLevel {
  label: string;
  price: number;
  kind?: "support" | "resistance" | "pivot" | "range" | "other";
}

interface BiasEntry {
  id: string;
  date: string;
  instrument: string;
  direction: "long" | "short" | "neutral";
  htfContext?: string;
  keyLevels: KeyLevel[];
  invalidation?: string;
  target?: string;
  notes?: string;
  lockedAt?: string;
}

const DIRECTION_CONFIG = {
  long:    { label: "Long",    classes: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800" },
  short:   { label: "Short",   classes: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-300 dark:border-red-800" },
  neutral: { label: "Neutral", classes: "bg-muted text-muted-foreground border-border" },
};

const COMMON_INSTRUMENTS = ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "NAS100", "SPX500", "BTCUSD", "USDCAD"];

function BiasCard({ entry, onLock, onDelete }: { entry: BiasEntry; onLock: (id: string) => void; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = DIRECTION_CONFIG[entry.direction];
  const isLocked = !!entry.lockedAt;

  return (
    <div className={cn("border rounded-lg overflow-hidden", isLocked ? "border-border/60 bg-muted/10" : "border-border bg-background")}>
      <div
        className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-sm">{entry.instrument}</span>
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border font-semibold", cfg.classes)}>
            {cfg.label}
          </Badge>
          {isLocked && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-1.5">
          {entry.target && <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[120px]">→ {entry.target}</span>}
          {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-border/40">
          {entry.htfContext && (
            <div className="pt-2.5">
              <p className="text-xs font-medium text-muted-foreground mb-1">HTF Context</p>
              <p className="text-sm text-foreground">{entry.htfContext}</p>
            </div>
          )}
          {entry.keyLevels.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Key Levels</p>
              <div className="flex flex-wrap gap-1.5">
                {entry.keyLevels.map((kl, i) => (
                  <span key={i} className={cn(
                    "text-xs px-2 py-0.5 rounded-full border font-mono",
                    kl.kind === "support" ? "bg-emerald-500/10 border-emerald-300/60 text-emerald-600 dark:text-emerald-400"
                      : kl.kind === "resistance" ? "bg-red-500/10 border-red-300/60 text-red-600 dark:text-red-400"
                      : "bg-muted border-border text-muted-foreground"
                  )}>
                    {kl.label} {kl.price.toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          )}
          {entry.invalidation && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Invalidation</p>
              <p className="text-sm text-red-600 dark:text-red-400">{entry.invalidation}</p>
            </div>
          )}
          {entry.notes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
              <p className="text-sm text-foreground">{entry.notes}</p>
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            {!isLocked && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onLock(entry.id)}>
                <Lock className="h-3 w-3" /> Lock Bias
              </Button>
            )}
            {isLocked && <span className="text-xs text-muted-foreground">Locked {format(new Date(entry.lockedAt!), "HH:mm")}</span>}
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive ml-auto" onClick={() => onDelete(entry.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddBiasForm({ onSave, onCancel }: { onSave: (data: Partial<BiasEntry>) => void; onCancel: () => void }) {
  const [instrument, setInstrument] = useState("");
  const [customInstrument, setCustomInstrument] = useState("");
  const [direction, setDirection] = useState<"long" | "short" | "neutral">("neutral");
  const [htfContext, setHtfContext] = useState("");
  const [invalidation, setInvalidation] = useState("");
  const [target, setTarget] = useState("");
  const [levelLabel, setLevelLabel] = useState("");
  const [levelPrice, setLevelPrice] = useState("");
  const [levelKind, setLevelKind] = useState<KeyLevel["kind"]>("pivot");
  const [keyLevels, setKeyLevels] = useState<KeyLevel[]>([]);

  const addLevel = () => {
    if (!levelLabel || !levelPrice) return;
    setKeyLevels([...keyLevels, { label: levelLabel, price: Number(levelPrice), kind: levelKind }]);
    setLevelLabel("");
    setLevelPrice("");
  };

  const final = instrument === "custom" ? customInstrument.toUpperCase() : instrument;

  return (
    <div className="border border-primary/30 rounded-lg p-3 space-y-3 bg-background">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Instrument</label>
          <Select value={instrument} onValueChange={setInstrument}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {COMMON_INSTRUMENTS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              <SelectItem value="custom">Custom…</SelectItem>
            </SelectContent>
          </Select>
          {instrument === "custom" && (
            <Input className="h-8 text-sm mt-1" placeholder="e.g. USDCHF" value={customInstrument} onChange={(e) => setCustomInstrument(e.target.value)} />
          )}
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Bias</label>
          <Select value={direction} onValueChange={(v) => setDirection(v as any)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="long">Long</SelectItem>
              <SelectItem value="short">Short</SelectItem>
              <SelectItem value="neutral">Neutral</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">HTF Context (why this bias?)</label>
        <Textarea className="text-sm min-h-[60px] resize-none" placeholder="Price rejected daily supply, sitting below 4H bearish OB…" value={htfContext} onChange={(e) => setHtfContext(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Invalidation</label>
          <Input className="h-8 text-sm" placeholder="Bias wrong if…" value={invalidation} onChange={(e) => setInvalidation(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Target</label>
          <Input className="h-8 text-sm" placeholder="Bias plays to…" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
      </div>

      {/* Key levels */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Key Levels</label>
        <div className="flex gap-1.5">
          <Input className="h-7 text-xs" placeholder="Label (e.g. PDH)" value={levelLabel} onChange={(e) => setLevelLabel(e.target.value)} />
          <Input className="h-7 text-xs w-24" placeholder="Price" type="number" value={levelPrice} onChange={(e) => setLevelPrice(e.target.value)} />
          <Select value={levelKind} onValueChange={(v) => setLevelKind(v as any)}>
            <SelectTrigger className="h-7 text-xs w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="support">Support</SelectItem>
              <SelectItem value="resistance">Resistance</SelectItem>
              <SelectItem value="pivot">Pivot</SelectItem>
              <SelectItem value="range">Range</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={addLevel}><Plus className="h-3 w-3" /></Button>
        </div>
        {keyLevels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {keyLevels.map((kl, i) => (
              <button key={i} className="text-xs px-2 py-0.5 rounded-full bg-muted border border-border font-mono hover:opacity-70" onClick={() => setKeyLevels(keyLevels.filter((_, j) => j !== i))}>
                {kl.label} {kl.price} ×
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1 h-8 text-xs" disabled={!final || !direction} onClick={() => onSave({ instrument: final, direction, htfContext, invalidation, target, keyLevels })}>
          Save Bias
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export default function BiasPanel() {
  const today = new Date().toISOString().split("T")[0];
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: biases = [] } = useQuery<BiasEntry[]>({
    queryKey: ["/api/trading/bias", today],
    queryFn: async () => {
      const res = await fetch(`/api/trading/bias?date=${today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<BiasEntry>) => {
      const res = await fetch("/api/trading/bias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...data, date: today }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/trading/bias", today] }); setShowForm(false); },
    onError: () => toast({ title: "Failed to save bias", variant: "destructive" }),
  });

  const lockMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/trading/bias/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lock: true }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/trading/bias", today] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/trading/bias/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/trading/bias", today] }),
  });

  return (
    <div className="space-y-3">
      {biases.map((b) => (
        <BiasCard
          key={b.id}
          entry={b}
          onLock={(id) => lockMutation.mutate(id)}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
      ))}

      {biases.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground text-center py-4">No bias set for today. Add your pre-market analysis.</p>
      )}

      {showForm ? (
        <AddBiasForm onSave={(data) => saveMutation.mutate(data)} onCancel={() => setShowForm(false)} />
      ) : (
        <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="h-3.5 w-3.5" /> Add Instrument Bias
        </Button>
      )}
    </div>
  );
}
