import { Settings, Sparkles } from "lucide-react";
import AISettings from "@/components/settings/ai-settings";
import SettingsNav from "@/components/settings/settings-nav";

export default function SettingsAIPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-5xl">
        <SettingsNav />
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-muted rounded-full">
            <Sparkles className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">AI Settings</h1>
            <p className="text-muted-foreground">
              Configure your AI assistant's model, behavior, and instructions
            </p>
          </div>
        </div>

        {/* AI Settings Component */}
        <AISettings />
      </div>
    </div>
  );
}
