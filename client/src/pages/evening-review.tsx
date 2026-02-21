import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, subDays, addDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Moon,
  CheckCircle2,
  Circle,
  Target,
  Rocket,
  ChevronRight,
  ChevronLeft,
  Trophy,
  TrendingUp,
  Calendar,
  Timer,
  Utensils,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useRoute, useLocation } from "wouter";
import { useDecisionModal } from "@/lib/decision-modal-store";
import { Lightbulb } from "lucide-react";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: "P0" | "P1" | "P2" | "P3" | null;
  focusDate: string | null;
  completedAt: string | null;
}

interface Top3Outcome {
  text: string;
  completed: boolean;
}

interface Day {
  id: string;
  date: string;
  title: string | null;
  top3Outcomes: Top3Outcome[] | null;
  oneThingToShip: string | null;
  reflectionAm: string | null;
  reflectionPm: string | null;
  mood: string | null;
  morningRituals: {
    pressUps?: { done: boolean; reps?: number };
    squats?: { done: boolean; reps?: number };
    supplements?: { done: boolean };
    reading?: { done: boolean; pages?: number };
    completedAt?: string;
  } | null;
  eveningRituals: {
    reviewCompleted?: boolean;
    journalEntry?: string;
    fastingHours?: number;
    fastingCompleted?: boolean;
    deepWorkHours?: number;
    completedAt?: string;
  } | null;
}

interface HealthEntry {
  id: string;
  date: string;
  sleepHours: number | null;
  workoutDone: boolean;
  steps: number | null;
  mood: string | null;
}

export default function EveningReview() {
  const { toast } = useToast();
  const [, params] = useRoute("/evening/:date");
  const [, setLocation] = useLocation();
  const { openDecisionModal } = useDecisionModal();

  // Use date from URL params, or default to today
  const todayDate = format(new Date(), "yyyy-MM-dd");
  const selectedDate = params?.date || todayDate;
  const isViewingToday = selectedDate === todayDate;

  // Parse the selected date for display and navigation
  const currentDate = parseISO(selectedDate);

  // Navigation helpers
  const goToPreviousDay = () => {
    const prevDate = format(subDays(currentDate, 1), "yyyy-MM-dd");
    setLocation(`/evening/${prevDate}`);
  };

  const goToNextDay = () => {
    const nextDate = format(addDays(currentDate, 1), "yyyy-MM-dd");
    if (nextDate <= todayDate) {
      setLocation(`/evening/${nextDate}`);
    }
  };

  const goToToday = () => {
    setLocation("/evening");
  };

  const [review, setReview] = useState({
    reflectionPm: "",
    reviewCompleted: false,
    fastingHours: 0,
    deepWorkHours: 0,
  });

  const [top3Outcomes, setTop3Outcomes] = useState<Top3Outcome[]>([]);

  // Fetch the selected day's data
  const { data: dayData, isLoading: isDayLoading } = useQuery<Day>({
    queryKey: ["/api/days", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/days/${selectedDate}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch day");
      return await res.json();
    },
  });

  // Fetch tasks for the selected day (includes focusDate, dueDate, and overdue tasks)
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks/today", { date: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/today?date=${selectedDate}`, { credentials: "include" });
      return await res.json();
    },
  });

  // Fetch health entry for the selected day
  const { data: healthEntries = [] } = useQuery<HealthEntry[]>({
    queryKey: ["/api/health", { startDate: selectedDate, endDate: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/health?startDate=${selectedDate}&endDate=${selectedDate}`, {
        credentials: "include",
      });
      return await res.json();
    },
  });

  const todayHealth = Array.isArray(healthEntries) ? healthEntries[0] : null;

  // Reset state when navigating to a different date
  useEffect(() => {
    setReview({
      reflectionPm: "",
      reviewCompleted: false,
      fastingHours: 0,
      deepWorkHours: 0,
    });
    setTop3Outcomes([]);
  }, [selectedDate]);

  // Load existing data when day data arrives
  useEffect(() => {
    if (dayData) {
      setReview({
        reflectionPm: dayData.reflectionPm || "",
        reviewCompleted: dayData.eveningRituals?.reviewCompleted || false,
        fastingHours: dayData.eveningRituals?.fastingHours || 0,
        deepWorkHours: dayData.eveningRituals?.deepWorkHours || 0,
      });

      // Load top3Outcomes
      if (Array.isArray(dayData.top3Outcomes)) {
        setTop3Outcomes(dayData.top3Outcomes);
      }
    }
  }, [dayData]);

  // Calculate day stats
  const completedTasks = Array.isArray(tasks) ? tasks.filter(t => t.status === "completed").length : 0;
  const totalTasks = Array.isArray(tasks) ? tasks.length : 0;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const morningRitualsComplete = dayData?.morningRituals
    ? Object.values(dayData.morningRituals)
        .filter(v => typeof v === "object" && v !== null)
        .every((v: any) => v.done)
    : false;

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const eveningRituals = {
        reviewCompleted: true,
        journalEntry: review.reflectionPm,
        fastingHours: review.fastingHours || undefined,
        fastingCompleted: review.fastingHours >= 16,
        deepWorkHours: review.deepWorkHours || undefined,
        completedAt: new Date().toISOString(),
      };

      const payload = {
        id: `day_${selectedDate}`,
        date: selectedDate,
        reflectionPm: review.reflectionPm || null,
        eveningRituals,
        top3Outcomes: top3Outcomes.length > 0 ? top3Outcomes : null,
      };

      // Try PATCH first, then POST if day doesn't exist
      try {
        const res = await apiRequest("PATCH", `/api/days/${selectedDate}`, payload);
        return await res.json();
      } catch (e) {
        const res = await apiRequest("POST", "/api/days", payload);
        return await res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/days"] });
      toast({
        title: "Evening review saved!",
        description: "Great job completing your daily review.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save review. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate();
  };

  const toggleOutcomeCompleted = (index: number) => {
    const newOutcomes = [...top3Outcomes];
    newOutcomes[index] = {
      ...newOutcomes[index],
      completed: !newOutcomes[index].completed,
    };
    setTop3Outcomes(newOutcomes);
  };

  if (isDayLoading) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="space-y-6">
          <div className="h-20 bg-muted animate-pulse rounded" />
          <div className="h-96 bg-muted animate-pulse rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 sm:p-3 bg-indigo-100 dark:bg-indigo-900/30 rounded-full shrink-0">
            <Moon className="h-6 w-6 sm:h-8 sm:w-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">Evening Review</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={goToPreviousDay}
                title="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-medium">
                {format(currentDate, "EEEE, MMMM d, yyyy")}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={goToNextDay}
                disabled={isViewingToday}
                title="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!isViewingToday && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs ml-2"
                  onClick={goToToday}
                >
                  <Calendar className="h-3 w-3 mr-1" />
                  Today
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isViewingToday && (
            <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
              Viewing Past Day
            </Badge>
          )}
          {review.reviewCompleted && (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Complete
            </Badge>
          )}
          {isViewingToday && (
            <Button
              variant="outline"
              onClick={() => openDecisionModal({ source: 'evening' })}
            >
              <Lightbulb className="h-4 w-4 mr-2" />
              Log Decision
            </Button>
          )}
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Complete Review"}
          </Button>
        </div>
      </div>

      {/* 1. Today's Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            Today's Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Tasks Completed */}
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-3xl font-bold text-blue-600">{completedTasks}/{totalTasks}</div>
              <div className="text-sm text-muted-foreground">Tasks Done</div>
              <Progress value={taskCompletionRate} className="h-2 mt-2" />
            </div>

            {/* Morning Rituals */}
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-3xl font-bold">
                {morningRitualsComplete ? (
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
                ) : (
                  <Circle className="h-8 w-8 text-gray-300 mx-auto" />
                )}
              </div>
              <div className="text-sm text-muted-foreground mt-1">Morning Rituals</div>
            </div>

            {/* Workout */}
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-3xl font-bold">
                {todayHealth?.workoutDone ? (
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
                ) : (
                  <Circle className="h-8 w-8 text-gray-300 mx-auto" />
                )}
              </div>
              <div className="text-sm text-muted-foreground mt-1">Workout</div>
            </div>

            {/* Steps */}
            <div className="text-center p-4 bg-muted/50 rounded-lg">
              <div className="text-3xl font-bold text-orange-600">
                {todayHealth?.steps ? todayHealth.steps.toLocaleString() : "—"}
              </div>
              <div className="text-sm text-muted-foreground">Steps</div>
            </div>
          </div>

          {/* One Thing to Ship Status */}
          {dayData?.oneThingToShip && (
            <div className="mt-4 p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Rocket className="h-4 w-4 text-purple-500" />
                <span className="font-medium text-sm">One Thing to Ship</span>
              </div>
              <p className="text-muted-foreground">{dayData.oneThingToShip}</p>
            </div>
          )}

          {/* Top 3 Outcomes */}
          {top3Outcomes.length > 0 && (
            <div className="mt-4 p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-4 w-4 text-blue-500" />
                <span className="font-medium text-sm">Today's Top 3 Outcomes</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {top3Outcomes.filter(o => o.completed).length}/{top3Outcomes.length} completed
                </span>
              </div>
              <div className="space-y-2">
                {top3Outcomes.map((outcome, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <Checkbox
                      id={`outcome-${index}`}
                      checked={outcome.completed}
                      onCheckedChange={() => toggleOutcomeCompleted(index)}
                    />
                    <Label
                      htmlFor={`outcome-${index}`}
                      className={`text-sm cursor-pointer flex-1 ${
                        outcome.completed ? "line-through text-muted-foreground" : ""
                      }`}
                    >
                      {outcome.text}
                    </Label>
                  </div>
                ))}
              </div>
              <Progress
                value={(top3Outcomes.filter(o => o.completed).length / top3Outcomes.length) * 100}
                className="h-2 mt-3"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Daily Metrics - Fasting & Deep Work */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-purple-500" />
            Daily Metrics
          </CardTitle>
          <CardDescription>
            Track your fasting window and deep work hours
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Fasting Hours */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Utensils className="h-4 w-4 text-orange-500" />
                <Label htmlFor="fasting-hours" className="font-medium">Fasting Hours</Label>
                <span className="text-xs text-muted-foreground ml-auto">Target: 16h</span>
              </div>
              <div className="flex items-center gap-3">
                <Input
                  id="fasting-hours"
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  placeholder="0"
                  value={review.fastingHours || ""}
                  onChange={(e) => setReview({ ...review, fastingHours: parseFloat(e.target.value) || 0 })}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">hours</span>
                {review.fastingHours >= 16 && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Target Met
                  </Badge>
                )}
              </div>
              <Progress
                value={Math.min((review.fastingHours / 16) * 100, 100)}
                className={`h-2 ${review.fastingHours >= 16 ? '[&>div]:bg-green-500' : '[&>div]:bg-orange-500'}`}
              />
            </div>

            {/* Deep Work Hours */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-purple-500" />
                <Label htmlFor="deep-work-hours" className="font-medium">Deep Work Hours</Label>
                <span className="text-xs text-muted-foreground ml-auto">Target: 5h</span>
              </div>
              <div className="flex items-center gap-3">
                <Input
                  id="deep-work-hours"
                  type="number"
                  min={0}
                  max={12}
                  step={0.5}
                  placeholder="0"
                  value={review.deepWorkHours || ""}
                  onChange={(e) => setReview({ ...review, deepWorkHours: parseFloat(e.target.value) || 0 })}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">hours</span>
                {review.deepWorkHours >= 5 && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Target Met
                  </Badge>
                )}
              </div>
              <Progress
                value={Math.min((review.deepWorkHours / 5) * 100, 100)}
                className={`h-2 ${review.deepWorkHours >= 5 ? '[&>div]:bg-green-500' : '[&>div]:bg-purple-500'}`}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Evening Reflection (full-width) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-500" />
            Evening Reflection
          </CardTitle>
          <CardDescription>
            What went well? What could be improved? What are you grateful for?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Today I accomplished... I learned... I'm grateful for... Tomorrow I will..."
            value={review.reflectionPm}
            onChange={(e) => setReview({ ...review, reflectionPm: e.target.value })}
            rows={6}
          />
        </CardContent>
      </Card>

      {/* 4. Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" asChild>
          <Link href="/dashboard">
            <ChevronRight className="h-4 w-4 mr-2" />
            Command Center
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/morning">
            <ChevronRight className="h-4 w-4 mr-2" />
            Morning Ritual
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/health-hub">
            <ChevronRight className="h-4 w-4 mr-2" />
            Log Health
          </Link>
        </Button>
      </div>
    </div>
  );
}
