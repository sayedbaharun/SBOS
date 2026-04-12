import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Sun, Shield, ShieldCheck } from "lucide-react";
import ProfileSettings from "@/components/settings/profile-settings";
import MorningRitualConfig from "@/components/settings/morning-ritual-config";
import SecuritySettings from "@/components/settings/security-settings";
import SettingsNav from "@/components/settings/settings-nav";
import { ApprovalPoliciesManager } from "@/components/approval-policies/approval-policies-manager";

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-5xl">
        <SettingsNav />

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-muted rounded-full">
            <User className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Profile Settings</h1>
            <p className="text-muted-foreground">
              Manage your profile and preferences
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="profile" className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Profile</span>
            </TabsTrigger>
            <TabsTrigger value="security" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Security</span>
            </TabsTrigger>
            <TabsTrigger value="morning" className="flex items-center gap-2">
              <Sun className="h-4 w-4" />
              <span className="hidden sm:inline">Morning Ritual</span>
            </TabsTrigger>
            <TabsTrigger value="policies" className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Agent Policies</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileSettings />
          </TabsContent>

          <TabsContent value="security">
            <SecuritySettings />
          </TabsContent>

          <TabsContent value="morning">
            <MorningRitualConfig />
          </TabsContent>

          <TabsContent value="policies">
            <ApprovalPoliciesManager />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
