import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CaptureModalProvider } from "@/lib/capture-modal-store";
import { TaskDetailModalProvider } from "@/lib/task-detail-modal-store";
import { DecisionModalProvider } from "@/lib/decision-modal-store";
import CaptureModal from "@/components/capture-modal";
import TaskDetailModal from "@/components/task-detail-modal";
import DecisionQuickCapture from "@/components/decision-quick-capture";
import Layout from "@/components/layout";
import MobileQuickActions from "@/components/mobile/mobile-quick-actions";
import InstallPrompt from "@/components/mobile/install-prompt";
import { lazy, Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { dailyRemindersService } from "@/lib/daily-reminders";

// Static imports — core paths loaded every session
import Landing from "@/pages/landing";
import CommandCenterV2 from "@/pages/command-center-v2";
import DailyPage from "@/pages/daily";
import NotFound from "@/pages/not-found";

// Lazy-loaded pages — split into separate chunks
const VentureHQ = lazy(() => import("@/pages/venture-hq"));
const VentureDetail = lazy(() => import("@/pages/venture-detail"));
const HealthHub = lazy(() => import("@/pages/health-hub"));
const KnowledgeHub = lazy(() => import("@/pages/knowledge-hub"));
const DocDetail = lazy(() => import("@/pages/doc-detail"));
const DeepWork = lazy(() => import("@/pages/deep-work"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const SettingsAIPage = lazy(() => import("@/pages/settings-ai"));
const SettingsIntegrationsPage = lazy(() => import("@/pages/settings-integrations"));
const SettingsCategoriesPage = lazy(() => import("@/pages/settings-categories"));
const CalendarPage = lazy(() => import("@/pages/calendar"));
const WeeklyPlanning = lazy(() => import("@/pages/weekly-planning"));
const Shopping = lazy(() => import("@/pages/shopping"));
const Books = lazy(() => import("@/pages/books"));
const Finance = lazy(() => import("@/pages/finance"));
const CapturePage = lazy(() => import("@/pages/capture"));
const TradingPage = lazy(() => import("@/pages/trading"));
const AiChat = lazy(() => import("@/pages/ai-chat"));
const AllTasks = lazy(() => import("@/pages/all-tasks"));
const AgentsPage = lazy(() => import("@/pages/agents"));
const AgentDetailPage = lazy(() => import("@/pages/agent-detail"));
const DelegationLogPage = lazy(() => import("@/pages/delegation-log"));
const PeoplePage = lazy(() => import("@/pages/people"));
const VentureLab = lazy(() => import("@/pages/venture-lab"));
const ResearchInbox = lazy(() => import("@/pages/research-inbox"));
const ReviewQueue = lazy(() => import("@/pages/review-queue"));
const LiveTasks = lazy(() => import("@/pages/live-tasks"));
const SettingsExternalAgents = lazy(() => import("@/pages/settings-external-agents"));
const SettingsCommandsPage = lazy(() => import("@/pages/settings-commands"));
const MemoryDashboard = lazy(() => import("@/pages/memory-dashboard"));
const GraphExplorer = lazy(() => import("@/pages/graph-explorer"));
const WikiPage = lazy(() => import("@/pages/wiki"));

function Router() {
  // Initialize daily reminders service on app load
  useEffect(() => {
    dailyRemindersService.init();
  }, []);

  return (
    <Switch>
      {/* Landing page without layout */}
      <Route path="/" component={Landing} />

      {/* Main app with layout */}
      <Route>
        <Layout>
          <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[50vh]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
          <Switch>
            <Route path="/dashboard" component={CommandCenterV2} />
            <Route path="/ventures" component={VentureHQ} />
            <Route path="/ventures/:id" component={VentureDetail} />
            <Route path="/venture-lab" component={VentureLab} />
            <Route path="/health-hub" component={HealthHub} />
            <Route path="/knowledge" component={KnowledgeHub} />
            <Route path="/knowledge/:id" component={DocDetail} />
            <Route path="/deep-work" component={DeepWork} />
            <Route path="/notifications" component={NotificationsPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/settings/ai" component={SettingsAIPage} />
            <Route path="/settings/integrations" component={SettingsIntegrationsPage} />
            <Route path="/settings/categories" component={SettingsCategoriesPage} />
            <Route path="/calendar" component={CalendarPage} />
            <Route path="/today" component={DailyPage} />
            <Route path="/today/:date" component={DailyPage} />
            <Route path="/morning">{() => <Redirect to="/today" />}</Route>
            <Route path="/morning/:date">{({ date }) => <Redirect to={`/today/${date}`} />}</Route>
            <Route path="/evening">{() => <Redirect to="/today" />}</Route>
            <Route path="/evening/:date">{({ date }) => <Redirect to={`/today/${date}`} />}</Route>
            <Route path="/weekly" component={WeeklyPlanning} />
            <Route path="/shopping" component={Shopping} />
            <Route path="/books" component={Books} />
            <Route path="/finance" component={Finance} />
            <Route path="/people" component={PeoplePage} />
            <Route path="/capture" component={CapturePage} />
            <Route path="/trading" component={TradingPage} />
            <Route path="/ai-chat" component={AiChat} />
            <Route path="/tasks" component={AllTasks} />
            <Route path="/research-inbox" component={ResearchInbox} />
            <Route path="/review" component={ReviewQueue} />
            <Route path="/live-tasks" component={LiveTasks} />
            <Route path="/settings/external-agents" component={SettingsExternalAgents} />
            <Route path="/settings/commands" component={SettingsCommandsPage} />
            <Route path="/agents" component={AgentsPage} />
            <Route path="/agents/delegation-log" component={DelegationLogPage} />
            <Route path="/agents/:slug" component={AgentDetailPage} />
            <Route path="/memory" component={MemoryDashboard} />
            <Route path="/graph" component={GraphExplorer} />
            <Route path="/wiki" component={WikiPage} />
            <Route component={NotFound} />
          </Switch>
          </Suspense>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CaptureModalProvider>
        <TaskDetailModalProvider>
          <DecisionModalProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
              <CaptureModal />
              <TaskDetailModal />
              <DecisionQuickCapture />
              {/* Mobile-specific components */}
              <MobileQuickActions />
              <InstallPrompt />
            </TooltipProvider>
          </DecisionModalProvider>
        </TaskDetailModalProvider>
      </CaptureModalProvider>
    </QueryClientProvider>
  );
}

export default App;
