import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, FolderKanban, CheckSquare, Target, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface ReadinessSummary {
  ventureId: string;
  score: number;
  currentTier: string;
}

async function fetchReadinessSummary(ventureId: string): Promise<ReadinessSummary> {
  const res = await apiRequest("GET", `/api/ventures/${ventureId}/launch-readiness`);
  const data = await res.json();
  return { ventureId, score: data.score || 0, currentTier: data.currentTier || 'pre-mvp' };
}

const TIER_BADGE: Record<string, { label: string; className: string }> = {
  'pre-mvp': { label: 'Pre-MVP', className: 'text-slate-600 border-slate-300' },
  mvp: { label: 'MVP ✓', className: 'text-amber-600 border-amber-300' },
  soft: { label: 'Soft ✓', className: 'text-blue-600 border-blue-300' },
  full: { label: 'Full ✓', className: 'text-green-600 border-green-300' },
};

interface Venture {
  id: string;
  name: string;
  slug?: string | null;
  status: string;
  oneLiner: string | null;
  domain: string;
  primaryFocus: string | null;
  color: string | null;
  icon: string | null;
}

interface Project {
  id: string;
  ventureId: string;
  status: string;
}

interface Task {
  id: string;
  ventureId: string | null;
  status: string;
}

interface VenturesGridProps {
  viewMode: "grid" | "list";
  statusFilters: string[];
}

export default function VenturesGrid({ viewMode, statusFilters }: VenturesGridProps) {
  const [, setLocation] = useLocation();

  const { data: ventures = [], isLoading: venturesLoading } = useQuery<Venture[]>({
    queryKey: ["/api/ventures"],
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "development":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "paused":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "archived":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  const getDomainColor = (domain: string) => {
    switch (domain) {
      case "saas":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
      case "media":
        return "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400";
      case "realty":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
      case "trading":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400";
      case "personal":
        return "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
    }
  };

  const getVentureStats = (ventureId: string) => {
    const ventureProjects = Array.isArray(projects) ? projects.filter((p) => p.ventureId === ventureId) : [];
    const activeProjects = ventureProjects.filter((p) =>
      p.status === "active" || p.status === "not_started" || p.status === "planning" || p.status === "in_progress"
    ).length;

    const ventureTasks = Array.isArray(tasks) ? tasks.filter((t) => t.ventureId === ventureId) : [];
    const openTasks = ventureTasks.filter((t) => t.status !== "completed" && t.status !== "on_hold").length;

    return {
      activeProjects,
      openTasks,
    };
  };

  if (venturesLoading) {
    return (
      <div className={cn(
        "grid gap-4",
        viewMode === "grid" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
      )}>
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-6 w-32 bg-muted animate-pulse rounded" />
              <div className="h-4 w-full bg-muted animate-pulse rounded mt-2" />
            </CardHeader>
            <CardContent>
              <div className="h-20 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Filter ventures by status
  // Filter by status - empty array means show all
  const filteredVentures = statusFilters.length === 0
    ? ventures
    : ventures.filter((v) => statusFilters.includes(v.status));

  if (ventures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] text-center border-2 border-dashed rounded-lg">
        <Briefcase className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <h3 className="text-lg font-semibold mb-2">No ventures yet</h3>
        <p className="text-sm text-muted-foreground">
          Create your first venture to get started
        </p>
      </div>
    );
  }

  if (filteredVentures.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] text-center border-2 border-dashed rounded-lg">
        <Briefcase className="h-16 w-16 text-muted-foreground/20 mb-4" />
        <h3 className="text-lg font-semibold mb-2">No ventures match filter</h3>
        <p className="text-sm text-muted-foreground">
          Try selecting a different status filter
        </p>
      </div>
    );
  }

  return (
    <div className={cn(
      "grid gap-4",
      viewMode === "grid" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
    )}>
      {filteredVentures.map((venture) => {
        const stats = getVentureStats(venture.id);
        return (
          <VentureCard
            key={venture.id}
            venture={venture}
            stats={stats}
            getStatusColor={getStatusColor}
            getDomainColor={getDomainColor}
            onClick={() => setLocation(`/ventures/${venture.slug || venture.id}`)}
          />
        );
      })}
    </div>
  );
}

// Separate component so each card can independently fetch its readiness score
function VentureCard({
  venture,
  stats,
  getStatusColor,
  getDomainColor,
  onClick,
}: {
  venture: Venture;
  stats: { activeProjects: number; openTasks: number };
  getStatusColor: (s: string) => string;
  getDomainColor: (d: string) => string;
  onClick: () => void;
}) {
  const { data: readiness } = useQuery<ReadinessSummary>({
    queryKey: [`launch-readiness-${venture.id}`],
    queryFn: () => fetchReadinessSummary(venture.id),
    staleTime: 5 * 60 * 1000,
  });

  const tierBadge = readiness && readiness.score > 0
    ? TIER_BADGE[readiness.currentTier]
    : null;

  return (
    <Card
      className="cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] border-l-4"
      style={{ borderLeftColor: venture.color || "#6366f1" }}
      onClick={onClick}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {venture.icon && <span className="text-2xl">{venture.icon}</span>}
            <CardTitle className="text-xl">{venture.name}</CardTitle>
          </div>
          {tierBadge && (
            <Badge variant="outline" className={`text-xs ${tierBadge.className} flex-shrink-0`}>
              <Gauge className="h-3 w-3 mr-1" />
              {tierBadge.label}
            </Badge>
          )}
        </div>
        {venture.oneLiner && (
          <CardDescription className="line-clamp-2">{venture.oneLiner}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Badge className={getStatusColor(venture.status)} variant="secondary">
              {venture.status}
            </Badge>
            <Badge className={getDomainColor(venture.domain)} variant="secondary">
              {venture.domain}
            </Badge>
            {readiness && readiness.score > 0 && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                {readiness.score}/100
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{stats.activeProjects}</span>
              <span className="text-muted-foreground">projects</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{stats.openTasks}</span>
              <span className="text-muted-foreground">tasks</span>
            </div>
          </div>

          {venture.primaryFocus && (
            <div className="pt-2 border-t">
              <div className="flex items-start gap-2 text-sm">
                <Target className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-muted-foreground line-clamp-2">{venture.primaryFocus}</p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
