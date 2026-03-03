import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cleanFormData } from "@/lib/utils";

interface Doc {
  id?: string;
  title: string;
  type: string;
  domain: string;
  status: string;
  ventureId?: string;
  projectId?: string;
  tags?: string[];
  body?: string;
}

interface DocEditorModalProps {
  open: boolean;
  onClose: () => void;
  doc?: Doc | null;
}

const DOC_TEMPLATES = {
  sop: `# [SOP Name]

## Purpose
What this SOP achieves

## When to Use
Situations where this applies

## Steps
1. Step one
2. Step two
3. Step three

## Notes
Additional context`,

  prompt: `# [Prompt Name]

## Context
What this prompt does

## Prompt
\`\`\`
[Your prompt here]
\`\`\`

## Variables
- \`{variable1}\`: Description
- \`{variable2}\`: Description

## Example Output
[Expected result]`,

  playbook: `# [Playbook Name]

## Goal
What we're trying to achieve

## Strategy
Overall approach

## Tactics
1. Tactic one
2. Tactic two

## Success Metrics
How we measure success`,

  spec: `# [Spec Name]

## Overview
Brief description

## Requirements
- Requirement 1
- Requirement 2

## Technical Details
[Technical specifications]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2`,

  template: `# [Template Name]

## Purpose
What this template is for

## Usage
How to use this template

## Template
[Your template content here]`,
};

export function DocEditorModal({ open, onClose, doc }: DocEditorModalProps) {
  const { toast } = useToast();
  const isEditing = !!doc?.id;

  const [formData, setFormData] = useState<Doc>({
    title: "",
    type: "sop",
    domain: "venture_ops",
    status: "draft",
    tags: [],
    body: "",
  });

  const [tagInput, setTagInput] = useState("");

  const { data: ventures = [] } = useQuery<any[]>({
    queryKey: ["/api/ventures"],
  });

  const { data: projects = [] } = useQuery<any[]>({
    queryKey: ["/api/projects"],
    enabled: !!formData.ventureId,
  });

  useEffect(() => {
    if (doc) {
      const normalizedTags = Array.isArray(doc.tags) ? doc.tags : (typeof doc.tags === 'string' ? doc.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);
      setFormData({ ...doc, tags: normalizedTags });
    } else {
      setFormData({
        title: "",
        type: "sop",
        domain: "venture_ops",
        status: "draft",
        tags: [],
        body: "",
      });
    }
  }, [doc, open]);

  const createMutation = useMutation({
    mutationFn: async (data: Doc) => {
      const res = await apiRequest("POST", "/api/docs", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docs"] });
      toast({
        title: "Document created",
        description: "Your document has been created successfully.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Doc) => {
      // Clean data to only send non-empty values
      const cleanData = cleanFormData(data);
      const res = await apiRequest("PATCH", `/api/docs/${data.id}`, cleanData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/docs"] });
      toast({
        title: "Document updated",
        description: "Your document has been updated successfully.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditing) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleTypeChange = (type: string) => {
    setFormData({
      ...formData,
      type,
      body: formData.body || DOC_TEMPLATES[type as keyof typeof DOC_TEMPLATES] || "",
    });
  };

  const addTag = () => {
    if (tagInput.trim() && !formData.tags?.includes(tagInput.trim())) {
      setFormData({
        ...formData,
        tags: [...(formData.tags || []), tagInput.trim()],
      });
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setFormData({
      ...formData,
      tags: formData.tags?.filter((t) => t !== tag) || [],
    });
  };

  const handleSaveDraft = () => {
    setFormData({ ...formData, status: "draft" });
    setTimeout(() => handleSubmit(new Event("submit") as any), 0);
  };

  const handlePublish = () => {
    setFormData({ ...formData, status: "active" });
    setTimeout(() => handleSubmit(new Event("submit") as any), 0);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Document" : "New Document"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing ? "Edit document content and metadata" : "Create a new document with markdown support"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter document title"
              required
            />
          </div>

          {/* Type and Domain - Side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="type">Type *</Label>
              <Select value={formData.type} onValueChange={handleTypeChange}>
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sop">SOP</SelectItem>
                  <SelectItem value="prompt">Prompt</SelectItem>
                  <SelectItem value="spec">Spec</SelectItem>
                  <SelectItem value="template">Template</SelectItem>
                  <SelectItem value="playbook">Playbook</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="domain">Domain *</Label>
              <Select
                value={formData.domain}
                onValueChange={(value) => setFormData({ ...formData, domain: value })}
              >
                <SelectTrigger id="domain">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="venture_ops">Venture Ops</SelectItem>
                  <SelectItem value="marketing">Marketing</SelectItem>
                  <SelectItem value="product">Product</SelectItem>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="personal">Personal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Venture and Project */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="venture">Venture (optional)</Label>
              <Select
                value={formData.ventureId || "none"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    ventureId: value === "none" ? undefined : value,
                    projectId: undefined,
                  })
                }
              >
                <SelectTrigger id="venture">
                  <SelectValue placeholder="Select venture" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {ventures.map((venture) => (
                    <SelectItem key={venture.id} value={venture.id}>
                      {venture.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="project">Project (optional)</Label>
              <Select
                value={formData.projectId || "none"}
                onValueChange={(value) =>
                  setFormData({
                    ...formData,
                    projectId: value === "none" ? undefined : value,
                  })
                }
                disabled={!formData.ventureId}
              >
                <SelectTrigger id="project">
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {projects
                    .filter((p) => p.ventureId === formData.ventureId)
                    .map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <Label htmlFor="tags">Tags</Label>
            <div className="flex gap-2 mb-2">
              <Input
                id="tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag and press Enter"
              />
              <Button type="button" onClick={addTag} variant="outline">
                Add
              </Button>
            </div>
            {formData.tags && formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-2 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Body */}
          <div>
            <Label htmlFor="body">Content *</Label>
            <Textarea
              id="body"
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              placeholder="Enter document content (Markdown supported)"
              className="min-h-[300px] font-mono text-sm"
              required
            />
            <p className="text-xs text-muted-foreground mt-1">
              Markdown syntax supported
            </p>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveDraft}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                Save Draft
              </Button>
              <Button
                type="button"
                onClick={handlePublish}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {isEditing ? "Update" : "Publish"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
