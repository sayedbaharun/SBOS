import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  BookOpen,
  Sparkles,
  RefreshCw,
  Search,
  Clock,
  Database,
  ChevronRight,
  ArrowLeft,
  Plus,
  Lightbulb,
  X,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";

// ── Types ────────────────────────────────────────────────────────────────────

interface WikiSummary {
  id: string;
  entityName: string;
  title: string;
  generatedAt: string | null;
  sourceCount: number;
  updatedAt: string;
  bodyPreview: string;
}

interface WikiDoc {
  id: string;
  title: string;
  body: string | null;
  metadata: {
    isWiki: boolean;
    wikiEntity: string;
    generatedAt: string;
    sourceCount: number;
  } | null;
  updatedAt: string;
}

interface Suggestion {
  name: string;
  mentionCount: number;
}

// ── Article view ─────────────────────────────────────────────────────────────

function ArticleView({
  entityName,
  onBack,
  onRegenerate,
}: {
  entityName: string;
  onBack: () => void;
  onRegenerate: (name: string) => void;
}) {
  const { data: doc, isLoading } = useQuery<WikiDoc>({
    queryKey: ["wiki-article", entityName],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/wiki/${encodeURIComponent(entityName)}`);
      return res.json();
    },
  });

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Nav */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          All Articles
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRegenerate(entityName)}
        >
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Regenerate
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      ) : doc ? (
        <Card>
          <CardContent className="pt-6">
            {/* Meta */}
            <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                {doc.metadata?.sourceCount ?? 0} sources
              </span>
              {doc.metadata?.generatedAt && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Generated {formatDistanceToNow(new Date(doc.metadata.generatedAt), { addSuffix: true })}
                </span>
              )}
            </div>

            {/* Article body */}
            <div className="prose prose-sm prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold mb-3 text-foreground">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-lg font-semibold mt-5 mb-2 text-foreground">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-medium mt-4 mb-1.5 text-foreground">{children}</h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-sm leading-relaxed text-foreground/90 mb-3">{children}</p>
                  ),
                  li: ({ children }) => (
                    <li className="text-sm text-foreground/90">{children}</li>
                  ),
                  code: ({ children }) => (
                    <code className="text-xs bg-muted px-1 rounded font-mono">{children}</code>
                  ),
                }}
              >
                {doc.body ?? "*No content yet.*"}
              </ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Article not found.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Article card ──────────────────────────────────────────────────────────────

function ArticleCard({ article, onClick }: { article: WikiSummary; onClick: () => void }) {
  return (
    <Card
      className="cursor-pointer hover:border-primary/40 transition-all group"
      onClick={onClick}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm truncate">{article.entityName}</h3>
              <Badge variant="outline" className="text-xs py-0 px-1.5 shrink-0">wiki</Badge>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {article.bodyPreview || "No preview available"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
        </div>

        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Database className="h-3 w-3" />
            {article.sourceCount} sources
          </span>
          {article.generatedAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(article.generatedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Generate dialog ───────────────────────────────────────────────────────────

function GeneratePanel({
  onGenerate,
  isGenerating,
}: {
  onGenerate: (name: string) => void;
  isGenerating: boolean;
}) {
  const [input, setInput] = useState("");

  const { data: suggestions } = useQuery<Suggestion[]>({
    queryKey: ["wiki-suggestions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wiki/suggestions");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Entity name (e.g. SyntheLIQ, Lead Scout)..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim() && !isGenerating) {
              onGenerate(input.trim());
              setInput("");
            }
          }}
          className="h-9 text-sm"
          disabled={isGenerating}
        />
        <Button
          size="sm"
          disabled={!input.trim() || isGenerating}
          onClick={() => {
            if (input.trim()) {
              onGenerate(input.trim());
              setInput("");
            }
          }}
        >
          {isGenerating ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Suggestions */}
      {suggestions && suggestions.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
            <Lightbulb className="h-3 w-3" />
            Suggested (entities with memories but no wiki yet)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.slice(0, 12).map((s) => (
              <button
                key={s.name}
                onClick={() => onGenerate(s.name)}
                disabled={isGenerating}
                className="flex items-center gap-1 px-2 py-1 rounded-full bg-muted/50 hover:bg-muted text-xs transition-colors disabled:opacity-50"
              >
                {s.name}
                <span className="text-muted-foreground">·{s.mentionCount}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function WikiPage() {
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: articles, isLoading } = useQuery<WikiSummary[]>({
    queryKey: ["wiki-list"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/wiki");
      return res.json();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (entityName: string) => {
      const res = await apiRequest("POST", "/api/wiki/generate", { entityName });
      return res.json();
    },
    onSuccess: (data, entityName) => {
      toast({
        title: data.created ? "Wiki created" : "Wiki updated",
        description: `${entityName} — ${data.sourceCount} sources synthesized`,
      });
      queryClient.invalidateQueries({ queryKey: ["wiki-list"] });
      queryClient.invalidateQueries({ queryKey: ["wiki-article", entityName] });
      queryClient.invalidateQueries({ queryKey: ["wiki-suggestions"] });
      setSelectedEntity(entityName);
      setShowGenerate(false);
    },
    onError: () => {
      toast({
        title: "Generation failed",
        description: "Check memory system status and try again.",
        variant: "destructive",
      });
    },
  });

  const batchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/wiki/batch", { limit: 10 });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Batch generation complete",
        description: `${data.generated} created, ${data.updated} updated, ${data.failed} failed`,
      });
      queryClient.invalidateQueries({ queryKey: ["wiki-list"] });
      queryClient.invalidateQueries({ queryKey: ["wiki-suggestions"] });
    },
  });

  const filteredArticles = (articles ?? []).filter(
    (a) =>
      !search ||
      a.entityName.toLowerCase().includes(search.toLowerCase())
  );

  // Viewing a specific article
  if (selectedEntity) {
    return (
      <div className="max-w-4xl mx-auto">
        <ArticleView
          entityName={selectedEntity}
          onBack={() => setSelectedEntity(null)}
          onRegenerate={(name) => generateMutation.mutate(name)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            Wiki
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Auto-synthesized knowledge articles from your memories
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={batchMutation.isPending}
            onClick={() => batchMutation.mutate()}
          >
            {batchMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Sparkles className="h-4 w-4 mr-1.5" />
            )}
            Generate Top 10
          </Button>
          <Button size="sm" onClick={() => setShowGenerate((v) => !v)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Article
          </Button>
        </div>
      </div>

      {/* Generate panel */}
      {showGenerate && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Generate Wiki Article
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowGenerate(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Searches your memory system, synthesizes findings, and stores as a wiki article.
              Takes ~10-15 seconds.
            </p>
          </CardHeader>
          <CardContent>
            <GeneratePanel
              onGenerate={(name) => generateMutation.mutate(name)}
              isGenerating={generateMutation.isPending}
            />
          </CardContent>
        </Card>
      )}

      {/* How it works (shown when empty) */}
      {!isLoading && (articles?.length ?? 0) === 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-6 pb-6 text-center space-y-3">
            <BookOpen className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <div>
              <p className="font-medium">No wiki articles yet</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Wiki articles are auto-synthesized from your memories. Click "Generate Top 10" to
                create articles for the most-mentioned entities, or generate one manually above.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-4 max-w-sm mx-auto text-left">
              {[
                { step: "1", label: "Searches memory", desc: "Iteratively queries hybrid retriever" },
                { step: "2", label: "Synthesizes", desc: "AI writes article with citations" },
                { step: "3", label: "Stores", desc: "Saved as Knowledge Hub doc" },
              ].map((s) => (
                <div key={s.step} className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs font-mono text-primary">{s.step}</p>
                  <p className="text-xs font-medium mt-1">{s.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.desc}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search + article list */}
      {(articles?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search articles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          ) : filteredArticles.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredArticles.map((a) => (
                <ArticleCard
                  key={a.id}
                  article={a}
                  onClick={() => setSelectedEntity(a.entityName)}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No articles match "{search}"</p>
          )}
        </div>
      )}
    </div>
  );
}
