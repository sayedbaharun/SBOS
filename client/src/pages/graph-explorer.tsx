import { useEffect, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useLocation } from "wouter";
import {
  Network,
  Search,
  X,
  RefreshCw,
  Brain,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronRight,
  TrendingUp,
  Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import MultiGraph from "graphology";
import { Sigma } from "sigma";
import circular from "graphology-layout/circular";
import forceAtlas2 from "graphology-layout-forceatlas2";

// ── Types ────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  type: string;
  description?: string;
  mentionCount: number;
  firstSeen?: number;
  lastSeen?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  strength: number;
}

interface SelectedNode extends GraphNode {
  connections: GraphEdge[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  person: "#3b82f6",       // blue
  organization: "#22c55e", // green
  project: "#a855f7",      // purple
  concept: "#f97316",      // orange
  location: "#ef4444",     // red
  venture: "#eab308",      // yellow/gold
};

const DEFAULT_COLOR = "#6b7280"; // gray

const ENTITY_BADGE_COLORS: Record<string, string> = {
  person: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  organization: "bg-green-500/20 text-green-400 border-green-500/30",
  project: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  concept: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  location: "bg-red-500/20 text-red-400 border-red-500/30",
  venture: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

// ── Node size by mention count ────────────────────────────────────────────────

function getNodeSize(mentionCount: number): number {
  if (mentionCount >= 20) return 20;
  if (mentionCount >= 10) return 14;
  if (mentionCount >= 5) return 10;
  return 6;
}

// ── Graph canvas component ────────────────────────────────────────────────────

function GraphCanvas({
  nodes,
  edges,
  highlightId,
  onNodeClick,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  highlightId: string | null;
  onNodeClick: (node: GraphNode, connectedEdges: GraphEdge[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<MultiGraph | null>(null);

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;

    // Build graphology graph
    const graph = new MultiGraph();
    graphRef.current = graph;

    const nodeSet = new Set<string>();

    for (const n of nodes) {
      if (!nodeSet.has(n.id)) {
        nodeSet.add(n.id);
        graph.addNode(n.id, {
          label: n.label,
          size: getNodeSize(n.mentionCount),
          color: NODE_COLORS[n.type] ?? DEFAULT_COLOR,
          x: Math.random(),
          y: Math.random(),
          // Custom attrs for hover/click
          nodeType: n.type,
          description: n.description ?? "",
          mentionCount: n.mentionCount,
        });
      }
    }

    // Add edges only if both endpoints exist
    for (const e of edges) {
      if (nodeSet.has(e.source) && nodeSet.has(e.target)) {
        try {
          graph.addEdge(e.source, e.target, {
            label: e.relationship,
            size: Math.max(1, (e.strength ?? 0.5) * 3),
            color: "rgba(120,120,120,0.3)",
          });
        } catch {
          // skip duplicate edges
        }
      }
    }

    // Apply circular layout then force-atlas2
    circular.assign(graph);
    forceAtlas2.assign(graph, {
      iterations: 150,
      settings: {
        gravity: 1,
        scalingRatio: 2,
        strongGravityMode: false,
        barnesHutOptimize: nodes.length > 100,
      },
    });

    // Initialize sigma
    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      defaultEdgeColor: "rgba(120,120,120,0.25)",
      defaultNodeColor: DEFAULT_COLOR,
      labelSize: 11,
      labelColor: { color: "#e5e7eb" },
      minCameraRatio: 0.1,
      maxCameraRatio: 10,
    });
    sigmaRef.current = sigma;

    // Click handler
    sigma.on("clickNode", ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      const connectedEdges = edges.filter(
        (e) => e.source === node || e.target === node
      );
      onNodeClick(
        {
          id: node,
          label: attrs.label ?? node,
          type: attrs.nodeType ?? "concept",
          description: attrs.description,
          mentionCount: attrs.mentionCount ?? 1,
        },
        connectedEdges
      );
    });

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [nodes, edges]);

  // Highlight a specific node
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    graph.forEachNode((node) => {
      const isHighlighted = highlightId === null || node === highlightId;
      graph.setNodeAttribute(node, "color",
        isHighlighted
          ? (NODE_COLORS[graph.getNodeAttribute(node, "nodeType") ?? ""] ?? DEFAULT_COLOR)
          : "rgba(80,80,80,0.3)"
      );
    });

    sigma.refresh();
  }, [highlightId]);

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Network className="h-12 w-12 opacity-30" />
        <div className="text-center">
          <p className="font-medium">No entities in graph yet</p>
          <p className="text-sm mt-1">Entities appear after agent conversations are compacted into memory.</p>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full" />;
}

// ── Node detail panel ─────────────────────────────────────────────────────────

function NodePanel({ node, edges, onClose }: { node: SelectedNode; edges: GraphEdge[]; onClose: () => void }) {
  const connections = edges.filter((e) => e.source === node.id || e.target === node.id);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between p-4 border-b">
        <div className="space-y-1">
          <h3 className="font-semibold">{node.label}</h3>
          <Badge
            variant="outline"
            className={cn("text-xs", ENTITY_BADGE_COLORS[node.type] ?? "text-muted-foreground")}
          >
            {node.type}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 -mr-1 -mt-1" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {node.description && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{node.description}</p>
            </div>
          )}

          <div className="flex gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Mentions</p>
              <p className="font-mono font-medium">{node.mentionCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Connections</p>
              <p className="font-mono font-medium">{connections.length}</p>
            </div>
          </div>

          {connections.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Relationships</p>
              <div className="space-y-1.5">
                {connections.map((e, i) => {
                  const other = e.source === node.id ? e.target : e.source;
                  const dir = e.source === node.id ? "→" : "←";
                  return (
                    <div key={i} className="flex items-center gap-2 bg-muted/30 rounded px-2.5 py-1.5 text-xs">
                      <span className="text-muted-foreground font-mono">{dir}</span>
                      <span className="font-medium truncate flex-1">{other}</span>
                      <Badge variant="outline" className="text-xs py-0 px-1 shrink-0">
                        {e.relationship}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({ filter, onToggle }: { filter: string | null; onToggle: (type: string) => void }) {
  const types = [
    { type: "person", label: "Person" },
    { type: "organization", label: "Org" },
    { type: "project", label: "Project" },
    { type: "concept", label: "Concept" },
    { type: "venture", label: "Venture" },
    { type: "location", label: "Location" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {types.map(({ type, label }) => (
        <button
          key={type}
          onClick={() => onToggle(type)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all",
            filter === type
              ? "border-white/30 bg-white/10"
              : "border-transparent bg-white/5 hover:bg-white/10 text-muted-foreground"
          )}
        >
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: NODE_COLORS[type] ?? DEFAULT_COLOR }}
          />
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function GraphExplorer() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  const { data: rawNodes, isLoading: nodesLoading } = useQuery<GraphNode[]>({
    queryKey: ["graph-nodes"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/graph/nodes?limit=200");
      return res.json();
    },
  });

  const { data: rawEdges, isLoading: edgesLoading } = useQuery<GraphEdge[]>({
    queryKey: ["graph-edges"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/graph/edges?limit=400");
      return res.json();
    },
  });

  const isLoading = nodesLoading || edgesLoading;

  // Filter nodes by type and search
  const nodes = (rawNodes ?? []).filter((n) => {
    if (typeFilter && n.type !== typeFilter) return false;
    if (search && !n.label.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Keep only edges where both endpoints are in the filtered node set
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (rawEdges ?? []).filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
  );

  const highlightId = search && nodes.length === 1 ? nodes[0].id : null;

  const handleNodeClick = useCallback((node: GraphNode, connEdges: GraphEdge[]) => {
    setSelectedNode({ ...node, connections: connEdges });
  }, []);

  const handleTypeToggle = (type: string) => {
    setTypeFilter((prev) => (prev === type ? null : type));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Network className="h-6 w-6 text-primary" />
            Knowledge Graph
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Loading…" : `${rawNodes?.length ?? 0} entities · ${rawEdges?.length ?? 0} relationships`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/memory")}>
          <Brain className="h-4 w-4 mr-1.5" />
          Memory Dashboard
        </Button>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter nodes..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              onClick={() => setSearch("")}
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <Legend filter={typeFilter} onToggle={handleTypeToggle} />
      </div>

      {/* Main Canvas + Side Panel */}
      <div className="flex-1 flex gap-4 min-h-0">
        <div className={cn(
          "flex-1 bg-muted/20 rounded-xl border overflow-hidden transition-all",
          selectedNode ? "basis-[calc(100%-280px)]" : "basis-full"
        )}>
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="space-y-3 text-center">
                <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
                <p className="text-sm text-muted-foreground">Loading knowledge graph…</p>
              </div>
            </div>
          ) : (
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              highlightId={highlightId}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        {/* Node detail panel */}
        {selectedNode && (
          <div className="w-[280px] shrink-0 border rounded-xl bg-card overflow-hidden">
            <NodePanel
              node={selectedNode}
              edges={rawEdges ?? []}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}
      </div>

      {/* Footer stats */}
      {!isLoading && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
          <span>Showing {nodes.length} of {rawNodes?.length ?? 0} nodes</span>
          <span>·</span>
          <span>{edges.length} edges</span>
          {typeFilter && (
            <>
              <span>·</span>
              <button
                onClick={() => setTypeFilter(null)}
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <X className="h-3 w-3" /> Clear filter
              </button>
            </>
          )}
          <span className="ml-auto">Click a node to explore connections</span>
        </div>
      )}
    </div>
  );
}
