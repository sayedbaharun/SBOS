import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { KnowledgeHubHeader } from "@/components/knowledge-hub/knowledge-hub-header";
import { FiltersSidebar, DocsFilters } from "@/components/knowledge-hub/filters-sidebar";
import { DocsLibrary } from "@/components/knowledge-hub/docs-library";
import { DocEditorModal } from "@/components/knowledge-hub/doc-editor-modal";
import { DocCreationWizard } from "@/components/docs/doc-creation-wizard";
import { DriveFilesBrowser } from "@/components/knowledge-hub/drive-files-browser";
import { QualityDashboard } from "@/components/knowledge-hub/quality-dashboard";
import { ReviewQueue } from "@/components/knowledge-hub/review-queue";
import { AiPerformance } from "@/components/knowledge-hub/ai-performance";
import { KnowledgeFilesBrowser } from "@/components/knowledge-hub/knowledge-files-browser";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Cloud, Sparkles, FileUp, Loader2, Trash2, CheckSquare, X } from "lucide-react";
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

interface Doc {
  id: string;
  title: string;
  type: string;
  domain: string;
  status: string;
  ventureId?: string;
  projectId?: string;
  tags?: string[];
  body?: string;
  createdAt: string;
  updatedAt: string;
}

export default function KnowledgeHub() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"grid" | "list" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<DocsFilters>({
    types: [],
    domains: [],
    statuses: [],
    tags: [],
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Doc | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<string | null>(null);
  const [clipDialogOpen, setClipDialogOpen] = useState(false);
  const [clipUrl, setClipUrl] = useState("");
  const [clipVentureId, setClipVentureId] = useState<string>("");
  const [clipTags, setClipTags] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Fetch all docs
  const { data: allDocs = [], isLoading } = useQuery<Doc[]>({
    queryKey: ["/api/docs"],
  });

  // Fetch search results if there's a search query
  const { data: searchResults = [] } = useQuery<Doc[]>({
    queryKey: ["/api/docs/search", searchQuery],
    enabled: searchQuery.length > 0,
  });

  // Fetch ventures and projects for filters
  const { data: ventures = [] } = useQuery<any[]>({
    queryKey: ["/api/ventures"],
  });

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["/api/projects"],
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/docs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docs"] });
      toast({
        title: "Document deleted",
        description: "The document has been deleted successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/docs/${id}`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docs"] });
      toast({
        title: "Documents deleted",
        description: `${selectedIds.size} document(s) deleted successfully.`,
      });
      setSelectedIds(new Set());
      setSelectMode(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleToggleSelect = (docId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === displayedDocs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedDocs.map((d) => d.id)));
    }
  };

  const confirmBulkDelete = () => {
    bulkDeleteMutation.mutate(Array.from(selectedIds));
    setBulkDeleteDialogOpen(false);
  };

  // Clip URL mutation
  const clipMutation = useMutation({
    mutationFn: async (data: { url: string; ventureId?: string; tags?: string[] }) => {
      const res = await apiRequest("POST", "/api/docs/clip-url", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/docs"] });
      toast({
        title: "URL clipped",
        description: `"${data.title}" saved to Knowledge Hub (${data.wordCount} words)`,
      });
      setClipDialogOpen(false);
      setClipUrl("");
      setClipVentureId("");
      setClipTags("");
    },
    onError: (error: Error) => {
      toast({
        title: "Clip failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClipSubmit = () => {
    if (!clipUrl.trim()) return;
    clipMutation.mutate({
      url: clipUrl.trim(),
      ventureId: clipVentureId || undefined,
      tags: clipTags ? clipTags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
    });
  };

  // Filter and search logic
  const displayedDocs = useMemo(() => {
    // Ensure arrays are valid
    const docsArray = Array.isArray(allDocs) ? allDocs : [];
    const resultsArray = Array.isArray(searchResults) ? searchResults : [];
    let docs = searchQuery.length > 0 ? resultsArray : docsArray;

    // Apply filters
    if (filters.types.length > 0) {
      docs = docs.filter((doc) => filters.types.includes(doc.type));
    }
    if (filters.domains.length > 0) {
      docs = docs.filter((doc) => filters.domains.includes(doc.domain));
    }
    if (filters.statuses.length > 0) {
      docs = docs.filter((doc) => filters.statuses.includes(doc.status));
    }
    if (filters.ventureId) {
      docs = docs.filter((doc) => doc.ventureId === filters.ventureId);
    }
    if (filters.projectId) {
      docs = docs.filter((doc) => doc.projectId === filters.projectId);
    }
    if (filters.tags.length > 0) {
      docs = docs.filter((doc) =>
        filters.tags.some((tag) => doc.tags?.includes(tag))
      );
    }

    return docs;
  }, [allDocs, searchResults, searchQuery, filters]);

  const handleNewDoc = () => {
    // Open the new creation wizard instead of the old editor
    setWizardOpen(true);
  };

  const handleEditDoc = (doc: Doc) => {
    setEditingDoc(doc);
    setEditorOpen(true);
  };

  const handleDuplicateDoc = (doc: Doc) => {
    // Create a copy without the id (treated as new doc)
    const { id, createdAt, updatedAt, ...rest } = doc;
    const duplicated = {
      ...rest,
      title: `${doc.title} (Copy)`,
      status: "draft" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Pass as partial doc for creation (null signals new doc mode)
    setEditingDoc(null);
    setEditorOpen(true);
    // Pre-fill the form with duplicated values after a tick
    setTimeout(() => setEditingDoc({ ...duplicated, id: crypto.randomUUID() } as Doc), 0);
  };

  const handleDeleteDoc = (docId: string) => {
    setDocToDelete(docId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (docToDelete) {
      deleteMutation.mutate(docToDelete);
      setDeleteDialogOpen(false);
      setDocToDelete(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading documents...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <KnowledgeHubHeader
        onNewDoc={handleNewDoc}
        onClipUrl={() => setClipDialogOpen(true)}
        onSearch={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectMode={selectMode}
        onToggleSelectMode={() => {
          setSelectMode(!selectMode);
          if (selectMode) setSelectedIds(new Set());
        }}
      />

      {/* Select mode bar */}
      {selectMode && (
        <div className="flex items-center gap-3 bg-muted/60 border rounded-lg px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={handleSelectAll}>
            <CheckSquare className="h-4 w-4 mr-1.5" />
            {selectedIds.size === displayedDocs.length ? "Deselect All" : "Select All"}
          </Button>
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="destructive"
            size="sm"
            disabled={selectedIds.size === 0 || bulkDeleteMutation.isPending}
            onClick={() => setBulkDeleteDialogOpen(true)}
          >
            {bulkDeleteMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-1.5" />
            )}
            Delete ({selectedIds.size})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectMode(false);
              setSelectedIds(new Set());
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <Tabs defaultValue="local" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="local" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Local Docs
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-2">
            <FileUp className="h-4 w-4" />
            Files
          </TabsTrigger>
          <TabsTrigger value="quality" className="gap-2">
            <Sparkles className="h-4 w-4" />
            Quality Metrics
          </TabsTrigger>
          <TabsTrigger value="drive" className="gap-2">
            <Cloud className="h-4 w-4" />
            Google Drive
          </TabsTrigger>
        </TabsList>

        <TabsContent value="local">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Mobile: Filters button above content */}
            <div className="lg:hidden">
              <FiltersSidebar filters={filters} onFiltersChange={setFilters} />
            </div>

            <div className="lg:col-span-3">
              <DocsLibrary
                docs={displayedDocs}
                viewMode={viewMode}
                ventures={ventures}
                projects={projects}
                onEdit={handleEditDoc}
                onDelete={handleDeleteDoc}
                onDuplicate={handleDuplicateDoc}
                selectMode={selectMode}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
              />
            </div>

            {/* Desktop: Sidebar */}
            <div className="hidden lg:block">
              <FiltersSidebar filters={filters} onFiltersChange={setFilters} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="files">
          <KnowledgeFilesBrowser ventures={ventures} />
        </TabsContent>

        <TabsContent value="quality">
          <div className="space-y-6">
            {/* Quality Metrics Overview */}
            <QualityDashboard />

            {/* Review Queue and AI Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Review Queue</CardTitle>
                </CardHeader>
                <CardContent>
                  <ReviewQueue limit={10} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>AI Performance</CardTitle>
                </CardHeader>
                <CardContent>
                  <AiPerformance />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="drive">
          <DriveFilesBrowser />
        </TabsContent>
      </Tabs>

      {/* Editor Modal - for editing existing docs */}
      <DocEditorModal
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingDoc(null);
        }}
        doc={editingDoc}
      />

      {/* Creation Wizard - for new docs */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-4xl h-[85vh] p-0 overflow-hidden">
          <DocCreationWizard
            onSuccess={(doc) => {
              setWizardOpen(false);
              queryClient.invalidateQueries({ queryKey: ["/api/docs"] });
              toast({
                title: "Document created",
                description: `"${doc.title}" has been created successfully.`,
              });
            }}
            onCancel={() => setWizardOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Clip URL Dialog */}
      <Dialog open={clipDialogOpen} onOpenChange={setClipDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clip URL to Knowledge Hub</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="clip-url">URL</Label>
              <Input
                id="clip-url"
                placeholder="https://example.com/article"
                value={clipUrl}
                onChange={(e) => setClipUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clip-venture">Venture (optional)</Label>
              <Select value={clipVentureId} onValueChange={setClipVentureId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select venture..." />
                </SelectTrigger>
                <SelectContent>
                  {ventures.map((v: any) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="clip-tags">Tags (comma-separated)</Label>
              <Input
                id="clip-tags"
                placeholder="research, ai, marketing"
                value={clipTags}
                onChange={(e) => setClipTags(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClipDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleClipSubmit} disabled={!clipUrl.trim() || clipMutation.isPending}>
              {clipMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Clip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this document? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDocToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} Documents</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedIds.size} document(s)? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkDelete} className="bg-destructive">
              Delete {selectedIds.size} Documents
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
