import { Switch, Route } from "wouter";
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
import Landing from "@/pages/landing";
import VentureHQ from "@/pages/venture-hq";
import VentureDetail from "@/pages/venture-detail";
import HealthHub from "@/pages/health-hub";
import KnowledgeHub from "@/pages/knowledge-hub";
import DocDetail from "@/pages/doc-detail";
import DeepWork from "@/pages/deep-work";
import NotificationsPage from "@/pages/notifications";
import SettingsPage from "@/pages/settings";
import SettingsAIPage from "@/pages/settings-ai";
import SettingsIntegrationsPage from "@/pages/settings-integrations";
import SettingsCategoriesPage from "@/pages/settings-categories";
import CalendarPage from "@/pages/calendar";
import MorningRitual from "@/pages/morning-ritual";
import EveningReview from "@/pages/evening-review";
import WeeklyPlanning from "@/pages/weekly-planning";
import Shopping from "@/pages/shopping";
import Books from "@/pages/books";
import Finance from "@/pages/finance";
import CapturePage from "@/pages/capture";
import TradingPage from "@/pages/trading";
import AiChat from "@/pages/ai-chat";
import AllTasks from "@/pages/all-tasks";
import AgentsPage from "@/pages/agents";
import AgentDetailPage from "@/pages/agent-detail";
import DelegationLogPage from "@/pages/delegation-log";
import CommandCenterV2 from "@/pages/command-center-v2";
import PeoplePage from "@/pages/people";
import VentureLab from "@/pages/venture-lab";
import ResearchInbox from "@/pages/research-inbox";
import SettingsExternalAgents from "@/pages/settings-external-agents";
import NotFound from "@/pages/not-found";
import MobileQuickActions from "@/components/mobile/mobile-quick-actions";
import InstallPrompt from "@/components/mobile/install-prompt";
import { useEffect } from "react";
import { dailyRemindersService } from "@/lib/daily-reminders";

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
            <Route path="/morning" component={MorningRitual} />
            <Route path="/morning/:date" component={MorningRitual} />
            <Route path="/evening" component={EveningReview} />
            <Route path="/evening/:date" component={EveningReview} />
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
            <Route path="/settings/external-agents" component={SettingsExternalAgents} />
            <Route path="/agents" component={AgentsPage} />
            <Route path="/agents/delegation-log" component={DelegationLogPage} />
            <Route path="/agents/:slug" component={AgentDetailPage} />
            <Route component={NotFound} />
          </Switch>
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
