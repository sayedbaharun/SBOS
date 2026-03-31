import { Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const commands = [
  {
    command: "/start",
    description: "Welcome message and usage guide",
  },
  {
    command: "/agents",
    description: "List all available AI agents",
  },
  {
    command: "/briefing",
    description: "Generate today's daily briefing via Chief of Staff",
  },
  {
    command: "/capture <text>",
    description: "Add item directly to inbox",
  },
  {
    command: "/today",
    description: "Top 3 outcomes, urgent tasks, and inbox count",
  },
  {
    command: "/tasks",
    description: "List active tasks numbered (max 10)",
  },
  {
    command: "/done <number>",
    description: "Mark a task complete by number from /tasks",
  },
  {
    command: "/shop <item> [#category]",
    description: "Add to shopping list — categories: #groceries, #household, #personal, #business",
  },
  {
    command: "/clip <url>",
    description: "Clip web article to Knowledge Hub (auto-embeds for RAG)",
  },
  {
    command: "/morning",
    description: "Mark all morning ritual habits as done in one tap",
  },
  {
    command: "/emails",
    description: "Today's email triage summary (urgent, action needed, info)",
  },
  {
    command: "/email <id>",
    description: "Full details of a specific triaged email",
  },
  {
    command: "/reply <id> <message>",
    description: "Send an email reply via Gmail",
  },
  {
    command: "/review",
    description: "Pending agent deliverables with approve / amend / reject buttons",
  },
  {
    command: "/delegate @<slug> <task>",
    description: "Delegate a task to a specific agent",
  },
  {
    command: "/btw <question>",
    description: "One-off question — no history saved, no context pollution",
  },
  {
    command: "/idea <description>",
    description: "Submit a business idea for validation research",
  },
  {
    command: "/idea -deep <description>",
    description: "Submit idea with thorough deep research",
  },
  {
    command: "/contact Name, email, phone",
    description: "Quick-capture a contact (name required, email/phone optional)",
  },
  {
    command: '/spawn <name> "<task>"',
    description: "Spawn a sub-agent to execute a research or execution task",
  },
  {
    command: "/subagents",
    description: "List recent sub-agent runs with status indicators",
  },
];

const smartHandlers = [
  {
    trigger: "Plain text",
    description: "Routes to Chief of Staff or NLP handler",
  },
  {
    trigger: "Bare URL",
    description: 'Auto-detects URLs and offers "Clip it?" inline button',
  },
  {
    trigger: "@agent-slug <message>",
    description: "Routes message directly to that specific agent (e.g. @cmo, @cto)",
  },
  {
    trigger: "NLP keywords",
    description: 'Auto-logs health and habits — e.g. "slept 8h", "morning done", "push day 45 mins"',
  },
];

export default function SettingsCommandsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-muted rounded-full">
            <Terminal className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Telegram Commands</h1>
            <p className="text-muted-foreground">
              All commands available via <span className="font-mono text-sm">@SBNexusBot</span>
            </p>
          </div>
        </div>

        {/* Commands */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commands</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {commands.map(({ command, description }) => (
                <div key={command} className="flex items-start gap-4 px-6 py-3">
                  <Badge variant="secondary" className="font-mono text-xs shrink-0 mt-0.5 whitespace-nowrap">
                    {command}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{description}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Smart Handlers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Smart Handlers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {smartHandlers.map(({ trigger, description }) => (
                <div key={trigger} className="flex items-start gap-4 px-6 py-3">
                  <Badge variant="outline" className="font-mono text-xs shrink-0 mt-0.5 whitespace-nowrap">
                    {trigger}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{description}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
