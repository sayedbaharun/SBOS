import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, CheckSquare, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import CreateTaskModal from "@/components/create-task-modal";
import { useTaskDetailModal } from "@/lib/task-detail-modal-store";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: "P0" | "P1" | "P2" | "P3";
  type: string;
  domain: string;
  ventureId: string | null;
  projectId: string | null;
  phaseId: string | null;
  dueDate: string | null;
  focusDate: string | null;
  completedAt: string | null;
}

interface Project {
  id: string;
  name: string;
  ventureId: string;
}

interface Phase {
  id: string;
  name: string;
  projectId: string;
  status: string;
  order: number;
}

interface TasksListProps {
  ventureId: string;
}

export default function TasksList({ ventureId }: TasksListProps) {
  const { toast } = useToast();
  const { openTaskDetail } = useTaskDetailModal();
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [phaseFilter, setPhaseFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("priority");

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks", ventureId],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?venture_id=${ventureId}`, {
        credentials: "include",
      });
      return await res.json();
    },
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects", ventureId],
    queryFn: async () => {
      const res = await fetch(`/api/projects?venture_id=${ventureId}`, {
        credentials: "include",
      });
      return await res.json();
    },
  });

  // Fetch phases for all projects in this venture
  const { data: phases = [] } = useQuery<Phase[]>({
    queryKey: ["/api/phases", "venture", ventureId],
    queryFn: async () => {
      // Fetch phases for each project and combine them
      const allPhases: Phase[] = [];
      for (const project of projects) {
        const res = await fetch(`/api/phases?project_id=${project.id}`, {
          credentials: "include",
        });
        const projectPhases = await res.json();
        allPhases.push(...projectPhases);
      }
      return allPhases;
    },
    enabled: projects.length > 0,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Task> }) => {
      const res = await apiRequest("PATCH", `/api/tasks/${id}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({
        title: "Success",
        description: "Task deleted",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    },
  });

  const handleToggleTask = (task: Task) => {
    const newStatus = task.status === "completed" ? "in_progress" : "completed";
    updateTaskMutation.mutate({
      id: task.id,
      data: { status: newStatus },
    });
  };

  const handleDeleteTask = (taskId: string) => {
    if (confirm("Are you sure you want to delete this task?")) {
      deleteTaskMutation.mutate(taskId);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "P0":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
      case "P1":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400";
      case "P2":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
      case "P3":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "business":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
      case "deep_work":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400";
      case "admin":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400";
      case "personal":
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
      case "learning":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  const getProjectName = (projectId: string | null) => {
    if (!projectId) return "No Project";
    const project = projects.find((p) => p.id === projectId);
    return project?.name || "Unknown Project";
  };

  const getPhaseName = (phaseId: string | null) => {
    if (!phaseId) return null;
    const phase = phases.find((p) => p.id === phaseId);
    return phase?.name || null;
  };

  // Apply filters
  let filteredTasks = tasks;

  if (statusFilter !== "all") {
    filteredTasks = filteredTasks.filter((t) => t.status === statusFilter);
  }

  if (priorityFilter !== "all") {
    filteredTasks = filteredTasks.filter((t) => t.priority === priorityFilter);
  }

  if (projectFilter !== "all") {
    filteredTasks = filteredTasks.filter((t) => t.projectId === projectFilter);
  }

  if (phaseFilter !== "all") {
    filteredTasks = filteredTasks.filter((t) => t.phaseId === phaseFilter);
  }

  // Apply sorting
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === "priority") {
      const priorityOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    if (sortBy === "dueDate") {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    }
    return 0;
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Tasks ({filteredTasks.length})</CardTitle>
        <Button size="sm" onClick={() => setCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Task
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="todo">To Do</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="P0">P0</SelectItem>
                <SelectItem value="P1">P1</SelectItem>
                <SelectItem value="P2">P2</SelectItem>
                <SelectItem value="P3">P3</SelectItem>
              </SelectContent>
            </Select>

            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={phaseFilter} onValueChange={setPhaseFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Phase" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Phases</SelectItem>
                {phases.map((phase) => {
                  const project = projects.find((p) => p.id === phase.projectId);
                  return (
                    <SelectItem key={phase.id} value={phase.id}>
                      {phase.name} {project ? `(${project.name})` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>

            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="dueDate">Due Date</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tasks List */}
          {sortedTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-center">
              <CheckSquare className="h-12 w-12 text-muted-foreground/20 mb-4" />
              <p className="text-sm text-muted-foreground">
                No tasks found
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedTasks.map((task) => (
                <div
                  key={task.id}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer",
                    task.status === "completed" && "opacity-60"
                  )}
                  onClick={() => openTaskDetail(task.id)}
                >
                  <Checkbox
                    checked={task.status === "completed"}
                    onCheckedChange={() => handleToggleTask(task)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge className={getPriorityColor(task.priority)} variant="secondary">
                        {task.priority ?? "—"}
                      </Badge>
                      {task.type && (
                      <Badge className={getTypeColor(task.type)} variant="secondary">
                        {task.type.replace("_", " ")}
                      </Badge>
                      )}
                      {task.projectId && (
                        <Badge variant="outline" className="text-xs">
                          {getProjectName(task.projectId)}
                        </Badge>
                      )}
                      {task.phaseId && getPhaseName(task.phaseId) && (
                        <Badge variant="outline" className="text-xs bg-muted">
                          {getPhaseName(task.phaseId)}
                        </Badge>
                      )}
                    </div>
                    <p
                      className={cn(
                        "text-sm font-medium",
                        task.status === "completed" && "line-through"
                      )}
                    >
                      {task.title}
                    </p>
                    {task.dueDate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Due: {new Date(task.dueDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>

    <CreateTaskModal
      open={createModalOpen}
      onOpenChange={setCreateModalOpen}
      defaultVentureId={ventureId}
    />
    </>
  );
}
