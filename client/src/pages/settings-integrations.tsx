import { Plug } from "lucide-react";
import IntegrationsStatus from "@/components/settings/integrations-status";
import SettingsNav from "@/components/settings/settings-nav";

export default function SettingsIntegrationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-5xl">
        <SettingsNav />
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-muted rounded-full">
            <Plug className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Integrations</h1>
            <p className="text-muted-foreground">
              Connect external services and manage API integrations
            </p>
          </div>
        </div>

        {/* Integrations Component */}
        <IntegrationsStatus />
      </div>
    </div>
  );
}
