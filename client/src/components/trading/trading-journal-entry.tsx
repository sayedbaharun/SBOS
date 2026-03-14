import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp,
  TrendingDown,
  Plus,
  Brain,
  AlertCircle,
  Smile,
  Frown,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { Day } from "@shared/schema";

interface Trade {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: string;
  stopLoss: string;
  takeProfit?: string;
  openDate: string;
  closeDate?: string;
  result?: "win" | "loss" | "breakeven" | "pending";
  pnl?: number;
}

interface TradingSession {
  id: string;
  timestamp: string;
  sessionName: string;
  pnl: number;
  notes: string;
  lessons: string;
  emotionalState: "calm" | "anxious" | "confident" | "frustrated";
  trades?: Trade[];
}

interface TradingJournalEntryProps {
  day: Day | null;
}

const emotionalStates = [
  { value: "calm", label: "Calm", icon: Smile, color: "text-green-500" },
  { value: "confident", label: "Confident", icon: TrendingUp, color: "text-blue-500" },
  { value: "anxious", label: "Anxious", icon: AlertCircle, color: "text-yellow-500" },
  { value: "frustrated", label: "Frustrated", icon: Frown, color: "text-red-500" },
] as const;

export default function TradingJournalEntry({ day }: TradingJournalEntryProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [pnl, setPnl] = useState("");
  const [notes, setNotes] = useState("");
  const [lessons, setLessons] = useState("");
  const [emotionalState, setEmotionalState] = useState<TradingSession["emotionalState"]>("calm");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [showTradeForm, setShowTradeForm] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const [newTrade, setNewTrade] = useState<Partial<Trade>>({
    direction: "long",
    openDate: today,
    result: "pending",
  });

  const sessions: TradingSession[] = day?.tradingJournal?.sessions || [];
  const totalPnl = sessions.reduce((sum, s) => sum + (s.pnl || 0), 0);

  const updateMutation = useMutation({
    mutationFn: async (updatedJournal: { sessions: TradingSession[] }) => {
      if (!day?.date) return;
      const res = await apiRequest("PATCH", `/api/days/${day.date}`, { tradingJournal: updatedJournal });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["days"] });
      setOpen(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setSessionName("");
    setPnl("");
    setNotes("");
    setLessons("");
    setEmotionalState("calm");
    setTrades([]);
    setShowTradeForm(false);
    setNewTrade({ direction: "long", openDate: today, result: "pending" });
  };

  const handleAddTrade = () => {
    if (!newTrade.symbol || !newTrade.entryPrice || !newTrade.stopLoss) return;

    const trade: Trade = {
      id: crypto.randomUUID(),
      symbol: newTrade.symbol.toUpperCase(),
      direction: newTrade.direction || "long",
      entryPrice: newTrade.entryPrice,
      stopLoss: newTrade.stopLoss,
      takeProfit: newTrade.takeProfit,
      openDate: newTrade.openDate || today,
      closeDate: newTrade.closeDate,
      result: newTrade.result || "pending",
      pnl: newTrade.pnl,
    };

    setTrades([...trades, trade]);
    setNewTrade({ direction: "long", openDate: today, result: "pending" });
    setShowTradeForm(false);
  };

  const handleRemoveTrade = (tradeId: string) => {
    setTrades(trades.filter(t => t.id !== tradeId));
  };

  const handleAddSession = () => {
    // Calculate total P&L from trades if trades exist and no manual P&L entered
    const tradePnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const sessionPnl = pnl ? parseFloat(pnl) : tradePnl;

    const newSession: TradingSession = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sessionName: sessionName || "Trading Session",
      pnl: sessionPnl,
      notes,
      lessons,
      emotionalState,
      trades: trades.length > 0 ? trades : undefined,
    };

    updateMutation.mutate({
      sessions: [...sessions, newSession],
    });
  };

  const handleDeleteSession = (sessionId: string) => {
    updateMutation.mutate({
      sessions: sessions.filter((s) => s.id !== sessionId),
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Trading Journal
          </CardTitle>
          <div className="flex items-center gap-3">
            {sessions.length > 0 && (
              <span
                className={cn(
                  "text-lg font-bold",
                  totalPnl > 0 ? "text-green-500" : totalPnl < 0 ? "text-red-500" : "text-muted-foreground"
                )}
              >
                {totalPnl > 0 ? "+" : ""}${totalPnl.toFixed(2)}
              </span>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1">
                  <Plus className="h-3 w-3" />
                  Add Session
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Log Trading Session</DialogTitle>
                  <DialogDescription className="sr-only">Record details of your trading session including P&L and lessons</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      Session Name
                    </label>
                    <Input
                      placeholder="e.g., Morning scalp, London open..."
                      value={sessionName}
                      onChange={(e) => setSessionName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      P&L ($) {trades.length > 0 && <span className="text-muted-foreground font-normal">(or calculated from trades)</span>}
                    </label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={pnl}
                      onChange={(e) => setPnl(e.target.value)}
                      className={cn(
                        parseFloat(pnl) > 0 && "border-green-500 focus-visible:ring-green-500",
                        parseFloat(pnl) < 0 && "border-red-500 focus-visible:ring-red-500"
                      )}
                    />
                  </div>

                  {/* Trades Section */}
                  <Separator />
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" />
                        Individual Trades
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowTradeForm(!showTradeForm)}
                      >
                        {showTradeForm ? <ChevronUp className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                        {showTradeForm ? "Hide" : "Add Trade"}
                      </Button>
                    </div>

                    {/* Trade Form */}
                    {showTradeForm && (
                      <div className="space-y-2 p-3 border rounded-lg bg-muted/30 mb-3">
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            placeholder="Symbol (XAUUSD)"
                            value={newTrade.symbol || ""}
                            onChange={(e) => setNewTrade({ ...newTrade, symbol: e.target.value.toUpperCase() })}
                          />
                          <Select
                            value={newTrade.direction}
                            onValueChange={(v) => setNewTrade({ ...newTrade, direction: v as "long" | "short" })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="long">Long</SelectItem>
                              <SelectItem value="short">Short</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Input
                            placeholder="Entry"
                            value={newTrade.entryPrice || ""}
                            onChange={(e) => setNewTrade({ ...newTrade, entryPrice: e.target.value })}
                          />
                          <Input
                            placeholder="Stop Loss"
                            value={newTrade.stopLoss || ""}
                            onChange={(e) => setNewTrade({ ...newTrade, stopLoss: e.target.value })}
                          />
                          <Input
                            placeholder="Take Profit"
                            value={newTrade.takeProfit || ""}
                            onChange={(e) => setNewTrade({ ...newTrade, takeProfit: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <Input
                            type="date"
                            value={newTrade.openDate || today}
                            onChange={(e) => setNewTrade({ ...newTrade, openDate: e.target.value })}
                          />
                          <Input
                            type="date"
                            placeholder="Close Date"
                            value={newTrade.closeDate || ""}
                            onChange={(e) => setNewTrade({ ...newTrade, closeDate: e.target.value })}
                          />
                          <Select
                            value={newTrade.result || "pending"}
                            onValueChange={(v) => setNewTrade({ ...newTrade, result: v as Trade["result"] })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="win">Win</SelectItem>
                              <SelectItem value="loss">Loss</SelectItem>
                              <SelectItem value="breakeven">Breakeven</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            placeholder="P&L ($)"
                            value={newTrade.pnl || ""}
                            onChange={(e) => setNewTrade({ ...newTrade, pnl: parseFloat(e.target.value) || undefined })}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleAddTrade}
                            disabled={!newTrade.symbol || !newTrade.entryPrice || !newTrade.stopLoss}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Trades List */}
                    {trades.length > 0 && (
                      <div className="space-y-2">
                        {trades.map((trade) => (
                          <div key={trade.id} className="flex items-center justify-between p-2 border rounded text-sm">
                            <div className="flex items-center gap-2">
                              <Badge variant={trade.direction === "long" ? "default" : "destructive"} className="text-xs">
                                {trade.direction}
                              </Badge>
                              <span className="font-medium">{trade.symbol}</span>
                              <span className="text-muted-foreground">@ {trade.entryPrice}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {trade.pnl !== undefined && (
                                <span className={cn(
                                  "font-medium",
                                  trade.pnl > 0 ? "text-green-500" : trade.pnl < 0 ? "text-red-500" : ""
                                )}>
                                  {trade.pnl > 0 ? "+" : ""}${trade.pnl.toFixed(2)}
                                </span>
                              )}
                              <Badge variant="outline" className="text-xs">{trade.result}</Badge>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => handleRemoveTrade(trade.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Separator />

                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      Emotional State
                    </label>
                    <Select
                      value={emotionalState}
                      onValueChange={(v) => setEmotionalState(v as TradingSession["emotionalState"])}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {emotionalStates.map((state) => (
                          <SelectItem key={state.value} value={state.value}>
                            <div className="flex items-center gap-2">
                              <state.icon className={cn("h-4 w-4", state.color)} />
                              {state.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">
                      Notes
                    </label>
                    <Textarea
                      placeholder="What happened during this session..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      Lessons Learned
                    </label>
                    <Textarea
                      placeholder="What did you learn? What would you do differently?"
                      value={lessons}
                      onChange={(e) => setLessons(e.target.value)}
                      rows={2}
                    />
                  </div>
                  <Button
                    onClick={handleAddSession}
                    disabled={updateMutation.isPending}
                    className="w-full"
                  >
                    {updateMutation.isPending ? "Saving..." : "Save Session"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No trading sessions logged today
          </p>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const stateInfo = emotionalStates.find((s) => s.value === session.emotionalState);
              const StateIcon = stateInfo?.icon || Smile;
              return (
                <div
                  key={session.id}
                  className="p-3 rounded-lg bg-muted/50 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{session.sessionName}</span>
                      <StateIcon className={cn("h-4 w-4", stateInfo?.color)} />
                      {session.trades && session.trades.length > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {session.trades.length} trade{session.trades.length > 1 ? "s" : ""}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "font-bold",
                          session.pnl > 0 ? "text-green-500" : session.pnl < 0 ? "text-red-500" : ""
                        )}
                      >
                        {session.pnl > 0 ? (
                          <TrendingUp className="inline h-3 w-3 mr-1" />
                        ) : session.pnl < 0 ? (
                          <TrendingDown className="inline h-3 w-3 mr-1" />
                        ) : null}
                        {session.pnl > 0 ? "+" : ""}${session.pnl.toFixed(2)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteSession(session.id)}
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                  {/* Show trades if present */}
                  {session.trades && session.trades.length > 0 && (
                    <div className="space-y-1 mt-2">
                      {session.trades.map((trade) => (
                        <div key={trade.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant={trade.direction === "long" ? "default" : "destructive"} className="text-xs py-0">
                            {trade.direction}
                          </Badge>
                          <span className="font-medium">{trade.symbol}</span>
                          <span>@ {trade.entryPrice}</span>
                          {trade.pnl !== undefined && (
                            <span className={cn(
                              trade.pnl > 0 ? "text-green-500" : trade.pnl < 0 ? "text-red-500" : ""
                            )}>
                              {trade.pnl > 0 ? "+" : ""}${trade.pnl.toFixed(2)}
                            </span>
                          )}
                          <Badge variant="outline" className="text-xs py-0">{trade.result}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                  {session.lessons && (
                    <p className="text-sm text-muted-foreground">
                      💡 {session.lessons}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
