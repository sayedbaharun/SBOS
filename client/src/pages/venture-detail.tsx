import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Plus, Bot, Settings, Sparkles, TrendingUp, MessageCircle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import VentureDetailHeader from "@/components/venture-hq/venture-detail-header";
import ProjectsBoard from "@/components/venture-hq/projects-board";
import VenturePhasesList from "@/components/venture-hq/venture-phases-list";
import TasksList from "@/components/venture-hq/tasks-list";
import VentureDocs from "@/components/docs/venture-docs";
import CreateProjectModal from "@/components/venture-hq/create-project-modal";
import ProjectWizard from "@/components/venture-hq/project-wizard";
import AiAgentConfig from "@/components/venture-hq/ai-agent-config";
import VentureAiChat from "@/components/venture-hq/venture-ai-chat";
import VentureContent from "@/components/venture-hq/venture-content";
import VentureGoals from "@/components/venture-hq/venture-goals";
import TradingHub from "@/components/trading/trading-hub";
import TradingAiChat from "@/components/trading/trading-ai-chat";
import LaunchReadinessTab from "@/components/venture/launch-readiness-tab";

interface Venture {
  id: string;
  name: string;
  status: string;
  oneLiner: string | null;
  domain: string;
  primaryFocus: string | null;
  color: string | null;
  icon: string | null;
}

export default function VentureDetail() {
  const [, params] = useRoute("/ventures/:id");
  const ventureId = params?.id;
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [projectWizardOpen, setProjectWizardOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("goals");
  const [aiSubTab, setAiSubTab] = useState<"chat" | "config">("chat");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check if this is a trading venture
  const isTradingVenture = (venture: Venture | undefined) =>
    venture?.domain === "trading" || venture?.name?.toLowerCase().includes("trading");

  const { data: venture, isLoading } = useQuery<Venture>({
    queryKey: ["/api/ventures", ventureId],
    queryFn: async () => {
      const res = await fetch(`/api/ventures/${ventureId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch venture");
      return await res.json();
    },
    enabled: !!ventureId,
  });

  // Fetch AI agent config for quick actions
  const { data: aiAgentConfig } = useQuery({
    queryKey: [`/api/ai-agent-prompts/venture/${ventureId}`],
    queryFn: async () => {
      const res = await fetch(`/api/ai-agent-prompts/venture/${ventureId}`, {
        credentials: "include",
      });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      return await res.json();
    },
    enabled: !!ventureId,
  });

  // Check if a Telegram topic exists for this venture
  const { data: telegramTopic } = useQuery<{ threadId: number; topicKey: string }>({
    queryKey: [`/api/ventures/${ventureId}/telegram-topic`],
    queryFn: async () => {
      const res = await fetch(`/api/ventures/${ventureId}/telegram-topic`, { credentials: "include" });
      if (res.status === 404) return null as any;
      if (!res.ok) return null as any;
      return res.json();
    },
    enabled: !!ventureId,
    retry: false,
  });

  const createTopicMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ventures/${ventureId}/create-telegram-topic`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create topic");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/ventures/${ventureId}/telegram-topic`] });
      toast({ title: "Telegram topic created", description: `Thread ID: ${data.threadId}` });
    },
    onError: () => {
      toast({ title: "Failed to create topic", description: "Check that the bot is an admin in the supergroup.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="space-y-6">
          <div className="h-32 bg-muted animate-pulse rounded" />
          <div className="h-96 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (!venture) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold mb-2">Venture Not Found</h1>
          <p className="text-muted-foreground">
            The venture you're looking for doesn't exist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <VentureDetailHeader venture={venture} />
        </div>
        {!telegramTopic && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => createTopicMutation.mutate()}
            disabled={createTopicMutation.isPending}
            className="shrink-0 mt-1"
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            {createTopicMutation.isPending ? "Creating..." : "Create Telegram Topic"}
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <TabsList className="inline-flex w-auto">
              <TabsTrigger value="goals" className="text-xs sm:text-sm">Goals</TabsTrigger>
              {isTradingVenture(venture) && (
                <TabsTrigger value="trading-hub" className="text-xs sm:text-sm whitespace-nowrap flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  Trading Hub
                </TabsTrigger>
              )}
              <TabsTrigger value="projects" className="text-xs sm:text-sm">Projects</TabsTrigger>
              <TabsTrigger value="phases" className="text-xs sm:text-sm">Phases</TabsTrigger>
              <TabsTrigger value="tasks" className="text-xs sm:text-sm">Tasks</TabsTrigger>
              <TabsTrigger value="docs" className="text-xs sm:text-sm whitespace-nowrap">Knowledge</TabsTrigger>
              <TabsTrigger value="content" className="text-xs sm:text-sm whitespace-nowrap">Content</TabsTrigger>
              <TabsTrigger value="launch" className="text-xs sm:text-sm whitespace-nowrap">Launch</TabsTrigger>
              <TabsTrigger value="ai-agent" className="text-xs sm:text-sm whitespace-nowrap">AI Agent</TabsTrigger>
            </TabsList>
          </div>

          {activeTab === "projects" && (
            <div className="flex gap-2 w-full sm:w-auto">
              <Button onClick={() => setProjectWizardOpen(true)} size="sm" variant="outline" className="flex-1 sm:flex-initial">
                <Sparkles className="h-4 w-4 mr-2" />
                AI Wizard
              </Button>
              <Button onClick={() => setCreateProjectModalOpen(true)} size="sm" className="flex-1 sm:flex-initial">
                <Plus className="h-4 w-4 mr-2" />
                New Project
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="goals">
          <VentureGoals ventureId={venture.id} />
        </TabsContent>

        {isTradingVenture(venture) && (
          <TabsContent value="trading-hub">
            <TradingHub ventureId={venture.id} />
          </TabsContent>
        )}

        <TabsContent value="projects">
          <ProjectsBoard ventureId={venture.id} />
        </TabsContent>

        <TabsContent value="phases">
          <VenturePhasesList ventureId={venture.id} />
        </TabsContent>

        <TabsContent value="tasks">
          <TasksList ventureId={venture.id} />
        </TabsContent>

        <TabsContent value="docs">
          <VentureDocs ventureId={venture.id} />
        </TabsContent>

        <TabsContent value="content">
          <VentureContent ventureId={venture.id} />
        </TabsContent>

        <TabsContent value="launch">
          <LaunchReadinessTab ventureId={venture.id} ventureName={venture.name} />
        </TabsContent>

        <TabsContent value="ai-agent" className="space-y-4">
          {isTradingVenture(venture) ? (
            /* Trading ventures use the specialized Trading AI directly */
            <Card className="h-[600px]">
              <CardContent className="p-6 h-full">
                <TradingAiChat />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Sub-tabs for AI Agent */}
              <div className="flex items-center gap-2 border-b pb-4">
                <Button
                  variant={aiSubTab === "chat" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAiSubTab("chat")}
                >
                  <Bot className="h-4 w-4 mr-2" />
                  Chat with AI
                </Button>
                <Button
                  variant={aiSubTab === "config" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setAiSubTab("config")}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Configure Agent
                </Button>
              </div>

              {aiSubTab === "chat" ? (
                <Card className="h-[600px]">
                  <CardContent className="p-6 h-full">
                    <VentureAiChat
                      ventureId={venture.id}
                      ventureName={venture.name}
                      quickActions={aiAgentConfig?.quickActions || []}
                    />
                  </CardContent>
                </Card>
              ) : (
                <AiAgentConfig ventureId={venture.id} />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <CreateProjectModal
        open={createProjectModalOpen}
        onOpenChange={setCreateProjectModalOpen}
        ventureId={venture.id}
      />

      <ProjectWizard
        open={projectWizardOpen}
        onOpenChange={setProjectWizardOpen}
        ventureId={venture.id}
        ventureName={venture.name}
      />
    </div>
  );
}
