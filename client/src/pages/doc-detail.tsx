import { useState, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  Edit,
  Trash2,
  Copy,
  FileText,
  Sparkles,
  FileCode,
  Layout,
  Book,
  StickyNote,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DocEditorModal } from "@/components/knowledge-hub/doc-editor-modal";
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
import { EnhancedMarkdownRenderer } from "@/components/docs/enhanced-markdown-renderer";
import { TableOfContents } from "@/components/docs/table-of-contents";
import { BacklinksPanel } from "@/components/docs/backlinks-panel";
import { ExportMenu } from "@/components/docs/export-menu";
import { ImageLightbox, useImageLightbox } from "@/components/docs/image-lightbox";

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

const typeIcons = {
  sop: FileText,
  prompt: Sparkles,
  spec: FileCode,
  template: Layout,
  playbook: Book,
};

const typeColors = {
  sop: "default",
  prompt: "secondary",
  spec: "outline",
  template: "default",
  playbook: "secondary",
} as const;

const domainColors = {
  venture_ops: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  marketing: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  product: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  sales: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  personal: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
};

const statusColors = {
  draft: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  active: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  archived: "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300",
};

export default function DocDetail() {
  const [, params] = useRoute("/knowledge/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const docId = params?.id;

  const { images, selectedIndex, lightboxOpen, setLightboxOpen } = useImageLightbox(contentRef);

  const { data: doc, isLoading } = useQuery<Doc>({
    queryKey: [`/api/docs/${docId}`],
    enabled: !!docId,
  });

  const { data: venture } = useQuery<any>({
    queryKey: [`/api/ventures/${doc?.ventureId}`],
    enabled: !!doc?.ventureId,
  });

  const { data: project } = useQuery<any>({
    queryKey: [`/api/projects/${doc?.projectId}`],
    enabled: !!doc?.projectId,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/docs/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docs"] });
      toast({
        title: "Document deleted",
        description: "The document has been deleted successfully.",
      });
      setLocation("/knowledge");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCopyContent = () => {
    if (doc?.body) {
      navigator.clipboard.writeText(doc.body);
      toast({
        title: "Copied",
        description: "Document content copied to clipboard",
      });
    }
  };

  const handleDelete = () => {
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    deleteMutation.mutate();
    setDeleteDialogOpen(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading document...</p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold mb-2">Document not found</h2>
          <p className="text-muted-foreground mb-4">
            The document you're looking for doesn't exist.
          </p>
          <Button onClick={() => setLocation("/knowledge")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Knowledge Hub
          </Button>
        </div>
      </div>
    );
  }

  const Icon = typeIcons[doc.type as keyof typeof typeIcons] || FileText;

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" onClick={() => setLocation("/knowledge")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Knowledge Hub
        </Button>

        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Icon className="h-8 w-8 text-primary" />
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={typeColors[doc.type as keyof typeof typeColors] || "default"}>
                  {doc.type === "sop" ? "SOP" : doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
                </Badge>
                <Badge className={statusColors[doc.status as keyof typeof statusColors]}>
                  {doc.status}
                </Badge>
              </div>
              <h1 className="text-3xl font-bold">{doc.title}</h1>
            </div>
          </div>

          <div className="flex gap-2">
            {doc.type === "prompt" && (
              <Button variant="outline" size="sm" onClick={handleCopyContent}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            )}
            <ExportMenu doc={{ title: doc.title, body: doc.body || "" }} />
            <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Content with TOC */}
      <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr] gap-6 mb-6">
        {/* Table of Contents - Hidden on mobile */}
        <aside className="hidden lg:block">
          <TableOfContents content={doc.body || ""} />
        </aside>

        {/* Main Content */}
        <div>
          <Card>
            <CardContent className="p-6">
              <div
                ref={contentRef}
                className="prose prose-sm dark:prose-invert max-w-none reading-mode"
              >
                <EnhancedMarkdownRenderer content={doc.body || ""} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Metadata */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">Metadata</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Domain</p>
              <Badge className={domainColors[(doc.domain || "personal") as keyof typeof domainColors]}>
                {(doc.domain || "general").replace("_", " ")}
              </Badge>
            </div>

            {venture && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Venture</p>
                <Badge variant="secondary">{venture.name}</Badge>
              </div>
            )}

            {project && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Project</p>
                <Badge variant="outline">{project.name}</Badge>
              </div>
            )}

            {doc.tags && (typeof doc.tags === 'string' ? doc.tags.length > 0 : doc.tags.length > 0) && (() => {
              const tagsArr = Array.isArray(doc.tags) ? doc.tags : (typeof doc.tags === 'string' ? doc.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);
              return tagsArr.length > 0 ? (
                <div className="col-span-2">
                  <p className="text-sm font-medium text-muted-foreground mb-2">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {tagsArr.map((tag: string) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Created</p>
              <p className="text-sm">
                {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Last Updated</p>
              <p className="text-sm">
                {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Backlinks */}
      <div className="mt-6">
        <BacklinksPanel
          docId={doc.id}
          docTitle={doc.title}
          defaultCollapsed={false}
        />
      </div>

      {/* Editor Modal */}
      <DocEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        doc={doc}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{doc.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Image Lightbox */}
      <ImageLightbox
        images={images}
        initialIndex={selectedIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
      />
    </div>
  );
}
