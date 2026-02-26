import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Sparkles,
  FileCode,
  Layout,
  Book,
  StickyNote,
  MoreVertical,
  Copy,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";

interface Doc {
  id: string;
  title: string;
  type: string;
  domain: string;
  status: string;
  ventureId?: string;
  projectId?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

interface DocCardProps {
  doc: Doc;
  ventureName?: string;
  projectName?: string;
  onEdit: (doc: Doc) => void;
  onDelete: (docId: string) => void;
  onDuplicate: (doc: Doc) => void;
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

export function DocCard({
  doc,
  ventureName,
  projectName,
  onEdit,
  onDelete,
  onDuplicate,
}: DocCardProps) {
  const [, setLocation] = useLocation();
  const Icon = typeIcons[doc.type as keyof typeof typeIcons] || FileText;

  const handleCardClick = () => {
    setLocation(`/knowledge/${doc.id}`);
  };

  return (
    <Card
      className="hover:shadow-lg transition-shadow cursor-pointer"
      onClick={handleCardClick}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <Badge variant={typeColors[doc.type as keyof typeof typeColors] || "default"}>
              {doc.type === "sop" ? "SOP" : doc.type.charAt(0).toUpperCase() + doc.type.slice(1)}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleCardClick();
                }}
              >
                View
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(doc);
                }}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(doc);
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(doc.id);
                }}
                className="text-destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardTitle className="text-lg line-clamp-2">{doc.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge className={domainColors[(doc.domain || "personal") as keyof typeof domainColors]}>
              {(doc.domain || "general").replace("_", " ")}
            </Badge>
            <Badge className={statusColors[doc.status as keyof typeof statusColors]}>
              {doc.status}
            </Badge>
          </div>
          {ventureName && (
            <Badge variant="secondary" className="text-xs">
              {ventureName}
            </Badge>
          )}
          {projectName && (
            <Badge variant="outline" className="text-xs">
              {projectName}
            </Badge>
          )}
          {doc.tags && (() => {
            const tagsArr = Array.isArray(doc.tags) ? doc.tags : (typeof doc.tags === 'string' ? (doc.tags as string).split(',').map(t => t.trim()).filter(Boolean) : []);
            return tagsArr.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tagsArr.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
                {tagsArr.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{tagsArr.length - 3} more
                  </Badge>
                )}
              </div>
            ) : null;
          })()}
          <p className="text-sm text-muted-foreground">
            Updated {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
