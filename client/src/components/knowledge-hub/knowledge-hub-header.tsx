import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookOpen, Plus, Search, Grid3x3, List, Table, LinkIcon, CheckSquare } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface KnowledgeHubHeaderProps {
  onNewDoc: () => void;
  onClipUrl: () => void;
  onSearch: (query: string) => void;
  viewMode: "grid" | "list" | "table";
  onViewModeChange: (mode: "grid" | "list" | "table") => void;
  onToggleSelectMode?: () => void;
  selectMode?: boolean;
}

export function KnowledgeHubHeader({
  onNewDoc,
  onClipUrl,
  onSearch,
  viewMode,
  onViewModeChange,
  onToggleSelectMode,
  selectMode = false,
}: KnowledgeHubHeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    onSearch(value);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <BookOpen className="h-6 w-6 sm:h-8 sm:w-8 text-primary shrink-0" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Knowledge Hub</h1>
          </div>
          <p className="text-sm sm:text-base text-muted-foreground">
            Your documented wisdom and processes
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button
            onClick={onToggleSelectMode}
            size="sm"
            variant={selectMode ? "secondary" : "outline"}
            className="flex-1 sm:flex-initial"
          >
            <CheckSquare className="h-4 w-4 mr-2" />
            Select
          </Button>
          <Button onClick={onClipUrl} size="sm" variant="outline" className="flex-1 sm:flex-initial">
            <LinkIcon className="h-4 w-4 mr-2" />
            Clip URL
          </Button>
          <Button onClick={onNewDoc} size="sm" className="flex-1 sm:flex-initial">
            <Plus className="h-4 w-4 mr-2" />
            New Document
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value) onViewModeChange(value as "grid" | "list" | "table");
          }}
          className="justify-center sm:justify-start"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <Grid3x3 className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="List view">
            <List className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table view">
            <Table className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}
