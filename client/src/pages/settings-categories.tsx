import { Layers } from "lucide-react";
import CategoriesManager from "@/components/settings/categories-manager";
import SettingsNav from "@/components/settings/settings-nav";

export default function SettingsCategoriesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-5xl">
        <SettingsNav />
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-muted rounded-full">
            <Layers className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Categories</h1>
            <p className="text-muted-foreground">
              Manage task and venture categories
            </p>
          </div>
        </div>

        {/* Categories Component */}
        <CategoriesManager />
      </div>
    </div>
  );
}
