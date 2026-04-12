/**
 * Trading Hub — Deep tools for the Trading Venture tab.
 * Contains: Daily Checklist, Strategies Manager, Journal, Knowledge Base, AI Agent.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Settings, History, Target, Bot, BookOpen, CheckSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TradingJournalEntry from "@/components/trading/trading-journal-entry";
import TradingStrategyDashboard from "@/components/trading/trading-strategy-dashboard";
import TradingStrategiesManager from "@/components/trading/trading-strategies-manager";
import TradingAiChat from "@/components/trading/trading-ai-chat";
import VentureDocs from "@/components/docs/venture-docs";
import type { Day } from "@shared/schema";

interface TradingHubProps {
  ventureId: string;
}

export default function TradingHub({ ventureId }: TradingHubProps) {
  const [activeTab, setActiveTab] = useState("checklist");

  const { data: day, isLoading: dayLoading } = useQuery<Day>({
    queryKey: ["/api/days/today"],
  });

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="inline-flex w-auto">
          <TabsTrigger value="checklist" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <CheckSquare className="h-3.5 w-3.5" />
            Checklist
          </TabsTrigger>
          <TabsTrigger value="strategies" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Settings className="h-3.5 w-3.5" />
            Strategies
          </TabsTrigger>
          <TabsTrigger value="journal" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <History className="h-3.5 w-3.5" />
            Journal
          </TabsTrigger>
          <TabsTrigger value="playbooks" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
            <BookOpen className="h-3.5 w-3.5" />
            Playbooks
          </TabsTrigger>
          <TabsTrigger value="ai-agent" className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap">
            <Bot className="h-3.5 w-3.5" />
            AI Agent
          </TabsTrigger>
        </TabsList>

        <TabsContent value="checklist" className="mt-4">
          <TradingStrategyDashboard />
        </TabsContent>

        <TabsContent value="strategies" className="mt-4">
          <TradingStrategiesManager />
        </TabsContent>

        <TabsContent value="journal" className="mt-4">
          {dayLoading ? (
            <div className="h-48 bg-muted animate-pulse rounded-lg" />
          ) : (
            <TradingJournalEntry day={day ?? null} />
          )}
        </TabsContent>

        <TabsContent value="playbooks" className="mt-4">
          <VentureDocs ventureId={ventureId} />
        </TabsContent>

        <TabsContent value="ai-agent" className="mt-4">
          <TradingAiChat />
        </TabsContent>
      </Tabs>
    </div>
  );
}
