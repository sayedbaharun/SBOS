import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import {
  TrendingUp,
  ArrowRight,
  CheckSquare,
  BookOpen,
  Bot,
  Settings,
  BarChart2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TradingSessionIndicator from "@/components/trading/trading-session-indicator";
import EconomicCalendar from "@/components/trading/economic-calendar";
import type { Venture } from "@shared/schema";

interface QuickLink {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tab: string;
}

const QUICK_LINKS: QuickLink[] = [
  {
    label: "Daily Checklist",
    description: "Execute today's strategy checklist",
    icon: CheckSquare,
    tab: "trading-hub",
  },
  {
    label: "Strategies",
    description: "Manage your trading strategies",
    icon: Settings,
    tab: "trading-hub",
  },
  {
    label: "Journal",
    description: "Log sessions and review P&L",
    icon: BarChart2,
    tab: "trading-hub",
  },
  {
    label: "Playbooks",
    description: "SOPs, setups, and playbooks",
    icon: BookOpen,
    tab: "trading-hub",
  },
  {
    label: "AI Agent",
    description: "Trading coach and analysis",
    icon: Bot,
    tab: "trading-hub",
  },
];

export default function TradingCommandCenter() {
  const [, navigate] = useLocation();
  const today = format(new Date(), "EEEE, MMMM d");

  const { data: ventures } = useQuery<Venture[]>({
    queryKey: ["/api/ventures"],
  });

  const tradingVenture = ventures?.find((v) => v.domain === "trading");

  function goToVentureTab(tab: string) {
    if (tradingVenture) {
      navigate(`/ventures/${tradingVenture.id}`);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6 max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center shadow-sm">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Trading Command Center</h1>
              <p className="text-sm text-muted-foreground">{today}</p>
            </div>
          </div>
          <TradingSessionIndicator />
        </div>

        {/* Venture CTA — only if trading venture exists */}
        {tradingVenture && (
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{tradingVenture.name}</span>
              <Badge variant="outline" className="text-xs">venture</Badge>
              {tradingVenture.oneLiner && (
                <span className="text-muted-foreground hidden sm:inline">— {tradingVenture.oneLiner}</span>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/ventures/${tradingVenture.id}`)}
            >
              Open Venture
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </div>
        )}

        {/* Main grid: calendar + quick links */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Economic Calendar — takes 2/3 */}
          <div className="lg:col-span-2">
            <EconomicCalendar />
          </div>

          {/* Quick Access — 1/3 */}
          <div className="space-y-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Quick Access
                </CardTitle>
                {!tradingVenture && (
                  <p className="text-xs text-muted-foreground">
                    Create a venture with domain "trading" to enable deep tools.
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {QUICK_LINKS.map((link) => {
                  const Icon = link.icon;
                  return (
                    <button
                      key={link.label}
                      disabled={!tradingVenture}
                      onClick={() => goToVentureTab(link.tab)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed border border-transparent hover:border-border"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium leading-tight">{link.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{link.description}</div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {/* Broker API placeholder */}
            <Card className="border-dashed">
              <CardContent className="p-4 text-center space-y-2">
                <BarChart2 className="h-8 w-8 mx-auto text-muted-foreground/50" />
                <p className="text-sm font-medium text-muted-foreground">Live Positions</p>
                <p className="text-xs text-muted-foreground">
                  Broker API integration coming soon. Connect your account to see open trades here.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
