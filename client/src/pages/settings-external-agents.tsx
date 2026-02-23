import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Bot,
  Plus,
  Loader2,
  Copy,
  Check,
  Trash2,
  Shield,
  ShieldOff,
  Clock,
  Key,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ExternalAgent {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  capabilities: string[] | null;
  lastSeenAt: string | null;
  createdAt: string;
}

interface CreateAgentResponse {
  agent: ExternalAgent;
  apiKey: string;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  suspended: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  revoked: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString();
}

export default function SettingsExternalAgents() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("research");
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [deleteAgent, setDeleteAgent] = useState<ExternalAgent | null>(null);

  const { data: agents = [], isLoading } = useQuery<ExternalAgent[]>({
    queryKey: ["external-agents"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/research/agents");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, type }: { name: string; type: string }) => {
      const res = await apiRequest("POST", "/api/research/agents/register", { name, type });
      return res.json() as Promise<CreateAgentResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["external-agents"] });
      setCreatedApiKey(data.apiKey);
      setNewName("");
      setNewType("research");
      toast({ title: "Agent registered", description: "Save the API key - it won't be shown again!" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to register agent.", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/research/agents/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["external-agents"] });
      toast({ title: "Agent updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update agent.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/research/agents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["external-agents"] });
      setDeleteAgent(null);
      toast({ title: "Agent deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete agent.", variant: "destructive" });
    },
  });

  const handleCopyKey = async () => {
    if (createdApiKey) {
      await navigator.clipboard.writeText(createdApiKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" />
            External Agents
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Register and manage external agents that can communicate with SB-OS.
          </p>
        </div>
        <Button onClick={() => { setShowCreate(true); setCreatedApiKey(null); }}>
          <Plus className="h-4 w-4 mr-2" />
          Register Agent
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && agents.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No external agents registered</h3>
            <p className="text-muted-foreground text-sm mt-1">
              Register an agent to allow it to submit research and query SB-OS.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Agent list */}
      <div className="space-y-3">
        {agents.map((agent) => (
          <Card key={agent.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{agent.name}</CardTitle>
                  <CardDescription className="text-xs font-mono">{agent.slug}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={statusColors[agent.status] || ""}>
                    {agent.status}
                  </Badge>
                  <Badge variant="outline">{agent.type}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Last seen: {formatDate(agent.lastSeenAt)}
                  </span>
                  <span>
                    Registered: {new Date(agent.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {agent.status === "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateStatusMutation.mutate({ id: agent.id, status: "suspended" })}
                    >
                      <ShieldOff className="h-3.5 w-3.5 mr-1" />
                      Suspend
                    </Button>
                  )}
                  {agent.status === "suspended" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateStatusMutation.mutate({ id: agent.id, status: "active" })}
                    >
                      <Shield className="h-3.5 w-3.5 mr-1" />
                      Reactivate
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteAgent(agent)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create Agent Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => {
        if (!open) {
          setShowCreate(false);
          setCreatedApiKey(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {createdApiKey ? "Agent Registered" : "Register External Agent"}
            </DialogTitle>
            <DialogDescription>
              {createdApiKey
                ? "Save this API key now. It won't be shown again."
                : "Create credentials for an external agent to communicate with SB-OS."}
            </DialogDescription>
          </DialogHeader>

          {!createdApiKey ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="agent-name">Agent Name</Label>
                <Input
                  id="agent-name"
                  placeholder="e.g. OpenClaw Research"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <Label>Agent Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="research">Research</SelectItem>
                    <SelectItem value="automation">Automation</SelectItem>
                    <SelectItem value="assistant">Assistant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-muted rounded-md">
                <Label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                  <Key className="h-3.5 w-3.5" />
                  API Key
                </Label>
                <code className="text-sm font-mono break-all">{createdApiKey}</code>
              </div>
              <Button variant="outline" className="w-full" onClick={handleCopyKey}>
                {copiedKey ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy API Key
                  </>
                )}
              </Button>
              <p className="text-xs text-destructive font-medium text-center">
                This key will not be shown again. Save it somewhere safe.
              </p>
            </div>
          )}

          <DialogFooter>
            {!createdApiKey ? (
              <>
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createMutation.mutate({ name: newName, type: newType })}
                  disabled={!newName.trim() || createMutation.isPending}
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Register
                </Button>
              </>
            ) : (
              <Button onClick={() => { setShowCreate(false); setCreatedApiKey(null); }}>
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteAgent} onOpenChange={(open) => !open && setDeleteAgent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Agent</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteAgent?.name}"? This will also delete all their research submissions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteAgent && deleteMutation.mutate(deleteAgent.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
