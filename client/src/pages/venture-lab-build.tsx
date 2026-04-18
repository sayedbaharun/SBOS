import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Wand2, Copy, Check, Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

interface BriefOutput {
  manusBrief: string;
  lovableBrief: string;
  evaluationPrompt: string;
}

const VENTURE_TYPE_OPTIONS = [
  { value: "service", label: "Service Business", desc: "Consulting, agency, done-for-you" },
  { value: "content-brand", label: "Content Brand", desc: "Faceless brand, media, social-first" },
  { value: "platform-app", label: "Platform / App", desc: "SaaS, tool, marketplace" },
  { value: "hnwi-network", label: "HNWI Network", desc: "Membership, syndicate, deal flow" },
  { value: "real-estate", label: "Real Estate", desc: "Listings, transactions, proptech" },
  { value: "personal-brand", label: "Personal Brand", desc: "Individual-led, offer ladder" },
];

const GOAL_OPTIONS = [
  { value: "validate-idea", label: "Validate the idea" },
  { value: "build-mvp", label: "Build an MVP" },
  { value: "build-marketing-site", label: "Build a marketing site" },
  { value: "build-tool", label: "Build a standalone tool" },
];

const PLATFORM_LINKS = {
  manus: "https://manus.ai",
  lovable: "https://lovable.dev",
};

export default function VentureLabBuild() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    description: "",
    ventureType: "",
    targetHosting: "vercel",
    primaryGoal: "build-mvp",
    ideaId: "",
  });
  const [brief, setBrief] = useState<BriefOutput | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (form.ideaId) {
        const res = await apiRequest("POST", `/api/venture-lab/ideas/${form.ideaId}/generate-brief`, {
          ventureType: form.ventureType,
          targetHosting: form.targetHosting,
          primaryGoal: form.primaryGoal,
        });
        const json = await res.json();
        return json.brief as BriefOutput;
      }
      throw new Error("Please link to a Venture Lab idea or use /venture-lab to create one first.");
    },
    onSuccess: (data) => {
      setBrief(data);
      toast({ title: "Briefs generated", description: "3 prompts ready to copy." });
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const canGenerate = form.ventureType && (form.ideaId || (form.name && form.description));

  return (
    <div className="container mx-auto py-8 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/venture-lab")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Venture Lab
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Build Brief Generator</h1>
          <p className="text-muted-foreground text-sm">Generate copy-paste briefs for Manus, Lovable, and evaluation</p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What are you building?</CardTitle>
          <CardDescription>Fill this in once — get 3 tool-specific briefs back.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Idea ID (from Venture Lab)</Label>
              <Input
                placeholder="paste idea UUID or leave blank"
                value={form.ideaId}
                onChange={e => setForm(p => ({ ...p, ideaId: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Link to an existing approved idea to save brief data</p>
            </div>
            <div className="space-y-1.5">
              <Label>Venture / Project Name</Label>
              <Input
                placeholder="e.g. OffPlanDub.ai"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>What does it do?</Label>
            <Textarea
              placeholder="One paragraph — what problem it solves, who it's for, and how it makes money"
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Venture Type</Label>
              <Select value={form.ventureType} onValueChange={v => setForm(p => ({ ...p, ventureType: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {VENTURE_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div>
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground">{opt.desc}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Target Hosting</Label>
              <Select value={form.targetHosting} onValueChange={v => setForm(p => ({ ...p, targetHosting: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vercel">Vercel (Next.js, Clerk, Neon)</SelectItem>
                  <SelectItem value="railway">Railway (Express, Session, PG)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Primary Goal</Label>
              <Select value={form.primaryGoal} onValueChange={v => setForm(p => ({ ...p, primaryGoal: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOAL_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => generateMutation.mutate()}
            disabled={!canGenerate || generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="mr-2 h-4 w-4" />
            )}
            Generate 3 Briefs
          </Button>
        </CardContent>
      </Card>

      {/* Briefs output */}
      {brief && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Briefs — Ready to Copy</CardTitle>
            <CardDescription>Copy each brief and paste into the appropriate tool.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="manus">
              <TabsList className="w-full">
                <TabsTrigger value="manus" className="flex-1">
                  Manus / Genspark
                  <Badge variant="secondary" className="ml-2 text-xs">Research + Brand</Badge>
                </TabsTrigger>
                <TabsTrigger value="lovable" className="flex-1">
                  Lovable / Replit
                  <Badge variant="secondary" className="ml-2 text-xs">Build Prototype</Badge>
                </TabsTrigger>
                <TabsTrigger value="eval" className="flex-1">
                  Evaluation Prompt
                  <Badge variant="secondary" className="ml-2 text-xs">After Build</Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="manus" className="space-y-3 mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-muted-foreground">Paste this into Manus or Genspark to generate research, branding, and content strategy.</p>
                    <a href={PLATFORM_LINKS.manus} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </a>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => copyToClipboard(brief.manusBrief, 'manus')}>
                    {copied === 'manus' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-2">{copied === 'manus' ? 'Copied!' : 'Copy'}</span>
                  </Button>
                </div>
                <Textarea value={brief.manusBrief} readOnly rows={16} className="font-mono text-sm resize-none" />
              </TabsContent>

              <TabsContent value="lovable" className="space-y-3 mt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-muted-foreground">Paste this into Lovable, Replit, or v0 to build the prototype with the right tech stack enforced.</p>
                    <a href={PLATFORM_LINKS.lovable} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </a>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => copyToClipboard(brief.lovableBrief, 'lovable')}>
                    {copied === 'lovable' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-2">{copied === 'lovable' ? 'Copied!' : 'Copy'}</span>
                  </Button>
                </div>
                <Textarea value={brief.lovableBrief} readOnly rows={16} className="font-mono text-sm resize-none" />
              </TabsContent>

              <TabsContent value="eval" className="space-y-3 mt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">After the prototype is built, paste this into Manus or Genspark to evaluate it. Then paste the results back into SB-OS.</p>
                  <Button size="sm" variant="outline" onClick={() => copyToClipboard(brief.evaluationPrompt, 'eval')}>
                    {copied === 'eval' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span className="ml-2">{copied === 'eval' ? 'Copied!' : 'Copy'}</span>
                  </Button>
                </div>
                <Textarea value={brief.evaluationPrompt} readOnly rows={16} className="font-mono text-sm resize-none" />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
