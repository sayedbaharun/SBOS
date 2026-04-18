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
  Target,
  ShieldCheck,
  Flame,
  LineChart,
  Radio,
  Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import TradingSessionIndicator from "@/components/trading/trading-session-indicator";
import EconomicCalendar from "@/components/trading/economic-calendar";
import MarketSnapshot from "@/components/trading/market-snapshot";
import PnlStrip from "@/components/trading/pnl-strip";
import RiskBudget from "@/components/trading/risk-budget";
import BiasPanel from "@/components/trading/bias-panel";
import DisciplineScorecard from "@/components/trading/discipline-scorecard";
import PerformancePanel from "@/components/trading/performance-panel";
import NewsWire from "@/components/trading/news-wire";
import LivePositions from "@/components/trading/live-positions";
import type { Venture } from "@shared/schema";

interface QuickLink {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  tab: string;
}

const QUICK_LINKS: QuickLink[] = [
  { label: "Daily Checklist",  description: "Execute today's strategy checklist", icon: CheckSquare, tab: "trading-hub" },
  { label: "Strategies",       description: "Manage your trading strategies",      icon: Settings,    tab: "trading-hub" },
  { label: "Journal",          description: "Log sessions and review P&L",         icon: BarChart2,   tab: "trading-hub" },
  { label: "Playbooks",        description: "SOPs, setups, and playbooks",         icon: BookOpen,    tab: "trading-hub" },
  { label: "AI Agent",         description: "Trading coach and analysis",          icon: Bot,         tab: "trading-hub" },
];

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{className?: string}>; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function TradingCommandCenter() {
  const [, navigate] = useLocation();
  const today = format(new Date(), "EEEE, MMMM d");

  const { data: ventures } = useQuery<Venture[]>({
    queryKey: ["/api/ventures"],
  });
  const tradingVenture = ventures?.find((v) => v.domain === "trading");

  function goToVenture() {
    if (tradingVenture) navigate(`/ventures/${tradingVenture.id}`);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6 max-w-7xl space-y-4">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-500 to-yellow-600 flex items-center justify-center shadow-sm shrink-0">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Trading Command Center</h1>
              <p className="text-sm text-muted-foreground">{today}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TradingSessionIndicator />
            {tradingVenture && (
              <Button size="sm" variant="outline" onClick={goToVenture} className="gap-1.5">
                <span className="hidden sm:inline">{tradingVenture.name}</span>
                <span className="sm:hidden">Hub</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* ── Market Snapshot bar ── */}
        <Card className="border-border/60">
          <CardContent className="py-3 px-4">
            <MarketSnapshot />
          </CardContent>
        </Card>

        {/* ── P&L Strip ── */}
        <Card className="border-border/60">
          <CardContent className="py-3 px-4">
            <PnlStrip />
          </CardContent>
        </Card>

        {/* ── Main 3-column grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Left column — Bias + Risk + Discipline */}
          <div className="space-y-4">
            <Section icon={Target} title="Today's Bias & Levels">
              <BiasPanel />
            </Section>

            <Section icon={ShieldCheck} title="Risk Budget">
              <RiskBudget />
            </Section>

            <Section icon={Flame} title="Discipline">
              <DisciplineScorecard />
            </Section>
          </div>

          {/* Centre column — Economic Calendar */}
          <div className="lg:col-span-1">
            <EconomicCalendar />
          </div>

          {/* Right column — News + Quick Access + Broker placeholder */}
          <div className="space-y-4">
            <Section icon={Radio} title="News Wire">
              <NewsWire />
            </Section>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Quick Access
                </CardTitle>
                {!tradingVenture && (
                  <p className="text-xs text-muted-foreground">Create a venture with domain "trading" to unlock deep tools.</p>
                )}
              </CardHeader>
              <CardContent className="space-y-1.5">
                {QUICK_LINKS.map((link) => {
                  const Icon = link.icon;
                  return (
                    <button
                      key={link.label}
                      disabled={!tradingVenture}
                      onClick={goToVenture}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-40 disabled:cursor-not-allowed border border-transparent hover:border-border"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-tight text-xs">{link.label}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{link.description}</div>
                      </div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            <Section icon={Activity} title="Live Positions">
              <LivePositions />
            </Section>
          </div>
        </div>

        {/* ── Performance Analytics (full-width) ── */}
        <Section icon={LineChart} title="Performance Analytics — Last 90 Days">
          <PerformancePanel />
        </Section>

      </div>
    </div>
  );
}
