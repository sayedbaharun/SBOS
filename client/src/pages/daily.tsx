import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, subDays, addDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sun,
  Moon,
  Dumbbell,
  Pill,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Droplets,
  Brain,
  Coffee,
  Bed,
  Footprints,
  Calendar,
  Target,
  Rocket,
  Sparkles,
  Timer,
  Utensils,
  Trophy,
  TrendingUp,
  Heart,
  Settings,
  Plus,
  Trash2,
  Apple,
  Flame,
  Beef,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useRoute, useLocation } from "wouter";

// ============================================================================
// TYPES
// ============================================================================

interface Day {
  id: string;
  date: string;
  title: string | null;
  morningRituals: Record<string, { done: boolean; reps?: number; pages?: number; count?: number }> | null;
  top3Outcomes: Top3Outcome[] | string | null;
  oneThingToShip: string | null;
  reflectionAm: string | null;
  reflectionPm: string | null;
  mood: string | null;
  primaryVentureFocus: string | null;
  proteinMet: boolean | null;
  caloriesOver2100: boolean | null;
  eveningRituals: {
    reviewCompleted?: boolean;
    fastingHours?: number;
    fastingCompleted?: boolean;
    deepWorkHours?: number;
    completedAt?: string;
  } | null;
}

interface Top3Outcome {
  text: string;
  completed: boolean;
  taskId?: string;
}

interface HealthEntry {
  id: number;
  date: string;
  sleepHours: number | null;
  sleepQuality: string | null;
  energyLevel: number | null;
  mood: string | null;
  stressLevel: string | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  steps: number | null;
  workoutDone: boolean;
  workoutType: string | null;
  workoutDurationMin: number | null;
  notes: string | null;
}

interface NutritionEntry {
  id: number;
  dayId: string | null;
  datetime: string;
  mealType: string;
  description: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatsG: number | null;
  context: string | null;
  tags: string | null;
  notes: string | null;
}

interface Venture {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  status: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: "P0" | "P1" | "P2" | "P3" | null;
  dueDate: string | null;
  focusDate: string | null;
  completedAt: string | null;
}

interface MorningHabitConfig {
  key: string;
  label: string;
  icon: string;
  hasCount: boolean;
  countLabel?: string;
  defaultCount?: number;
  enabled: boolean;
}

interface MorningRitualConfig {
  habits: MorningHabitConfig[];
}

// ============================================================================
// ICON MAP
// ============================================================================

const ICON_MAP: Record<string, LucideIcon> = {
  Dumbbell, Pill, BookOpen, Droplets, Brain, Coffee, Bed, Footprints, Sun,
};

const getIconComponent = (iconName: string): LucideIcon => ICON_MAP[iconName] || Sun;

// ============================================================================
// DEBOUNCE HOOK
// ============================================================================

function useDebouncedCallback<T extends (...args: any[]) => void>(callback: T, delay: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback((...args: Parameters<T>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => callbackRef.current(...args), delay);
  }, [delay]) as T;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function DailyPage() {
  const { toast } = useToast();
  const [, params] = useRoute("/today/:date");
  const [, setLocation] = useLocation();

  const todayDate = format(new Date(), "yyyy-MM-dd");
  const selectedDate = params?.date || todayDate;
  const isViewingToday = selectedDate === todayDate;
  const currentDate = parseISO(selectedDate);
  const dayId = `day_${selectedDate}`;

  // Navigation
  const goToPreviousDay = () => setLocation(`/today/${format(subDays(currentDate, 1), "yyyy-MM-dd")}`);
  const goToNextDay = () => {
    const next = format(addDays(currentDate, 1), "yyyy-MM-dd");
    if (next <= todayDate) setLocation(`/today/${next}`);
  };
  const goToToday = () => setLocation("/today");

  // ---- STATE ----

  // Morning habits
  const [rituals, setRituals] = useState<Record<string, { done: boolean; count?: number }>>({});

  // Plan
  const [top3Outcomes, setTop3Outcomes] = useState<Top3Outcome[]>([
    { text: "", completed: false },
    { text: "", completed: false },
    { text: "", completed: false },
  ]);
  const [planning, setPlanning] = useState({
    oneThingToShip: "",
    primaryVentureFocus: "",
  });

  // Health
  const [health, setHealth] = useState({
    sleepHours: "" as string | number,
    sleepQuality: "",
    energyLevel: "" as string | number,
    mood: "",
    weightKg: "" as string | number,
    bodyFatPercent: "" as string | number,
    stressLevel: "",
    steps: "" as string | number,
    workoutDone: false,
    workoutType: "",
    workoutDurationMin: "" as string | number,
  });

  // Evening
  const [evening, setEvening] = useState({
    reflectionPm: "",
    fastingHours: "" as string | number,
    deepWorkHours: "" as string | number,
  });

  const [healthEntryId, setHealthEntryId] = useState<number | null>(null);

  // Nutrition toggles
  const [proteinMet, setProteinMet] = useState(false);
  const [caloriesOver2100, setCaloriesOver2100] = useState(false);

  // Nutrition
  const [newMeal, setNewMeal] = useState({
    mealType: "",
    description: "",
    calories: "" as string | number,
    proteinG: "" as string | number,
  });

  // ---- DATA FETCHING ----

  const { data: habitConfig, isLoading: isConfigLoading } = useQuery<MorningRitualConfig>({
    queryKey: ["/api/settings/morning-ritual"],
  });

  const enabledHabits = useMemo(() => {
    return Array.isArray(habitConfig?.habits) ? habitConfig.habits.filter((h) => h.enabled) : [];
  }, [habitConfig?.habits]);

  const { data: dayData, isLoading: isDayLoading } = useQuery<Day>({
    queryKey: ["/api/days", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/days/${selectedDate}`, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch day");
      return await res.json();
    },
  });

  const { data: ventures = [] } = useQuery<Venture[]>({ queryKey: ["/api/ventures"] });
  const activeVentures = Array.isArray(ventures) ? ventures.filter((v) => v.status !== "archived") : [];

  const { data: healthEntries = [] } = useQuery<HealthEntry[]>({
    queryKey: ["/api/health", { startDate: selectedDate, endDate: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/health?startDate=${selectedDate}&endDate=${selectedDate}`, { credentials: "include" });
      return await res.json();
    },
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks/today", { date: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/today?date=${selectedDate}`, { credentials: "include" });
      return await res.json();
    },
  });

  const { data: dueTasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks", { dueDate: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?due_date=${selectedDate}`, { credentials: "include" });
      if (!res.ok) return [];
      return await res.json();
    },
  });

  const { data: nutritionEntries = [], isLoading: isNutritionLoading } = useQuery<NutritionEntry[]>({
    queryKey: ["/api/nutrition", { date: selectedDate }],
    queryFn: async () => {
      const res = await fetch(`/api/nutrition?startDate=${selectedDate}&endDate=${selectedDate}`, { credentials: "include" });
      if (!res.ok) return [];
      return await res.json();
    },
  });

  const priorityTasksDueToday = dueTasks.filter(
    (task) => (task.priority === "P0" || task.priority === "P1") && task.status !== "completed" && task.status !== "on_hold"
  );

  // ---- DERIVED VALUES ----

  const completedTasks = Array.isArray(tasks) ? tasks.filter((t) => t.status === "completed").length : 0;
  const totalTasks = Array.isArray(tasks) ? tasks.length : 0;
  const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const totalCalories = Array.isArray(nutritionEntries)
    ? nutritionEntries.reduce((sum, e) => sum + (e.calories || 0), 0)
    : 0;
  const totalProtein = Array.isArray(nutritionEntries)
    ? nutritionEntries.reduce((sum, e) => sum + (e.proteinG || 0), 0)
    : 0;
  const mealCount = Array.isArray(nutritionEntries) ? nutritionEntries.length : 0;

  // ---- EFFECTS: Initialize state from fetched data ----

  // Reset on date change
  useEffect(() => {
    if (enabledHabits.length > 0) {
      const initial: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        initial[habit.key] = { done: false, count: habit.hasCount ? habit.defaultCount : undefined };
      }
      setRituals(initial);
    }
    setTop3Outcomes([
      { text: "", completed: false },
      { text: "", completed: false },
      { text: "", completed: false },
    ]);
    setPlanning({ oneThingToShip: "", primaryVentureFocus: "" });
    setHealth({ sleepHours: "", sleepQuality: "", energyLevel: "", mood: "", weightKg: "", bodyFatPercent: "", stressLevel: "", steps: "", workoutDone: false, workoutType: "", workoutDurationMin: "" });
    setEvening({ reflectionPm: "", fastingHours: "", deepWorkHours: "" });
    setProteinMet(false);
    setCaloriesOver2100(false);
    setHealthEntryId(null);
    setNewMeal({ mealType: "", description: "", calories: "", proteinG: "" });
  }, [selectedDate]);

  // Initialize rituals from config
  useEffect(() => {
    if (enabledHabits.length > 0 && Object.keys(rituals).length === 0) {
      const initial: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        initial[habit.key] = { done: false, count: habit.hasCount ? habit.defaultCount : undefined };
      }
      setRituals(initial);
    }
  }, [enabledHabits]);

  // Load morning rituals + plan from day data
  useEffect(() => {
    if (dayData && enabledHabits.length > 0 && dayData.morningRituals) {
      const loaded: Record<string, { done: boolean; count?: number }> = {};
      for (const habit of enabledHabits) {
        const saved = dayData.morningRituals[habit.key];
        if (saved && typeof saved === "object") {
          loaded[habit.key] = {
            done: saved.done || false,
            count: habit.hasCount ? (saved.reps ?? saved.pages ?? saved.count ?? habit.defaultCount) : undefined,
          };
        } else {
          loaded[habit.key] = { done: false, count: habit.hasCount ? habit.defaultCount : undefined };
        }
      }
      setRituals(loaded);
    }
  }, [dayData, enabledHabits]);

  // Load plan data
  useEffect(() => {
    if (dayData) {
      if (Array.isArray(dayData.top3Outcomes)) {
        setTop3Outcomes(dayData.top3Outcomes as Top3Outcome[]);
      } else if (typeof dayData.top3Outcomes === "string" && dayData.top3Outcomes) {
        const lines = dayData.top3Outcomes.split("\n").filter((l) => l.trim());
        const outcomes = lines.map((line) => ({ text: line.replace(/^\d+\.\s*/, ""), completed: false }));
        while (outcomes.length < 3) outcomes.push({ text: "", completed: false });
        setTop3Outcomes(outcomes.slice(0, 3));
      }

      setPlanning({
        oneThingToShip: dayData.oneThingToShip || "",
        primaryVentureFocus: dayData.primaryVentureFocus || "",
      });

      setProteinMet(dayData.proteinMet || false);
      setCaloriesOver2100(dayData.caloriesOver2100 || false);

      // Evening data
      setEvening((prev) => ({
        ...prev,
        reflectionPm: dayData.reflectionPm || "",
        fastingHours: dayData.eveningRituals?.fastingHours || "",
        deepWorkHours: dayData.eveningRituals?.deepWorkHours || "",
      }));
    }
  }, [dayData]);

  // Load health entry
  useEffect(() => {
    const entry = Array.isArray(healthEntries) ? healthEntries[0] : null;
    if (entry) {
      setHealthEntryId(entry.id);
      setHealth({
        sleepHours: entry.sleepHours ?? "",
        sleepQuality: entry.sleepQuality ?? "",
        energyLevel: entry.energyLevel ?? "",
        mood: entry.mood ?? "",
        weightKg: entry.weightKg ?? "",
        bodyFatPercent: entry.bodyFatPercent ?? "",
        stressLevel: entry.stressLevel ?? "",
        steps: entry.steps ?? "",
        workoutDone: entry.workoutDone || false,
        workoutType: entry.workoutType ?? "",
        workoutDurationMin: entry.workoutDurationMin ?? "",
      });
    }
  }, [healthEntries]);

  // ---- HANDLERS ----

  const toggleHabit = (key: string) => {
    setRituals((prev) => ({ ...prev, [key]: { ...prev[key], done: !prev[key]?.done } }));
  };

  const updateCount = (key: string, count: number) => {
    setRituals((prev) => ({ ...prev, [key]: { ...prev[key], count } }));
  };

  const isAllRitualsComplete = () => enabledHabits.every((h) => rituals[h.key]?.done);

  const updateOutcomeText = (index: number, text: string) => {
    setTop3Outcomes((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], text };
      return updated;
    });
  };

  const toggleOutcomeCompleted = (index: number) => {
    setTop3Outcomes((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], completed: !updated[index].completed };
      return updated;
    });
  };

  // ---- NUTRITION MUTATIONS ----

  const addMealMutation = useMutation({
    mutationFn: async () => {
      const cal = typeof newMeal.calories === "string" ? parseFloat(newMeal.calories) : newMeal.calories;
      const pro = typeof newMeal.proteinG === "string" ? parseFloat(newMeal.proteinG) : newMeal.proteinG;
      const payload: Record<string, any> = {
        dayId,
        datetime: new Date().toISOString(),
        mealType: newMeal.mealType,
        description: newMeal.description,
      };
      if (cal) payload.calories = cal;
      if (pro) payload.proteinG = pro;
      await apiRequest("POST", "/api/nutrition", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nutrition"] });
      setNewMeal({ mealType: "", description: "", calories: "", proteinG: "" });
      toast({ title: "Meal logged", description: "Nutrition entry saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save meal.", variant: "destructive" });
    },
  });

  const deleteMealMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/nutrition/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nutrition"] });
      toast({ title: "Deleted", description: "Meal entry removed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete meal.", variant: "destructive" });
    },
  });

  // ---- SAVE ALL ----

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Build morning rituals payload
      const morningRituals: Record<string, any> = {};
      for (const habit of enabledHabits) {
        const ritual = rituals[habit.key];
        if (ritual) {
          morningRituals[habit.key] = { done: ritual.done };
        }
      }
      morningRituals.completedAt = isAllRitualsComplete() ? new Date().toISOString() : undefined;

      // Build evening rituals payload
      const fastingH = typeof evening.fastingHours === "string" ? parseFloat(evening.fastingHours) || 0 : evening.fastingHours;
      const deepWorkH = typeof evening.deepWorkHours === "string" ? parseFloat(evening.deepWorkHours) || 0 : evening.deepWorkHours;
      const eveningRituals = {
        reviewCompleted: !!evening.reflectionPm || fastingH > 0 || deepWorkH > 0,
        fastingHours: fastingH || undefined,
        fastingCompleted: fastingH >= 16,
        deepWorkHours: deepWorkH || undefined,
        completedAt: new Date().toISOString(),
      };

      const filteredOutcomes = top3Outcomes.filter((o) => o.text.trim());

      const dayPayload = {
        id: dayId,
        date: selectedDate,
        morningRituals,
        top3Outcomes: filteredOutcomes.length > 0 ? top3Outcomes : null,
        oneThingToShip: planning.oneThingToShip || null,
        reflectionPm: evening.reflectionPm || null,
        primaryVentureFocus: planning.primaryVentureFocus || null,
        proteinMet,
        caloriesOver2100,
        eveningRituals,
      };

      // Save day data
      try {
        await apiRequest("PATCH", `/api/days/${selectedDate}`, dayPayload);
      } catch {
        await apiRequest("POST", "/api/days", dayPayload);
      }

      // Save health data
      const sleepH = typeof health.sleepHours === "string" ? parseFloat(health.sleepHours) : health.sleepHours;
      const energyL = typeof health.energyLevel === "string" ? parseInt(String(health.energyLevel)) : health.energyLevel;
      const weightK = typeof health.weightKg === "string" ? parseFloat(health.weightKg) : health.weightKg;
      const bodyFatP = typeof health.bodyFatPercent === "string" ? parseFloat(health.bodyFatPercent) : health.bodyFatPercent;
      const stepsN = typeof health.steps === "string" ? parseInt(String(health.steps)) : health.steps;
      const workoutDurN = typeof health.workoutDurationMin === "string" ? parseInt(String(health.workoutDurationMin)) : health.workoutDurationMin;

      const healthPayload: Record<string, any> = { date: selectedDate };
      if (sleepH) healthPayload.sleepHours = sleepH;
      if (health.sleepQuality) healthPayload.sleepQuality = health.sleepQuality;
      if (energyL) healthPayload.energyLevel = energyL;
      if (health.mood) healthPayload.mood = health.mood;
      if (weightK) healthPayload.weightKg = weightK;
      if (bodyFatP) healthPayload.bodyFatPercent = bodyFatP;
      if (health.stressLevel) healthPayload.stressLevel = health.stressLevel;
      if (stepsN) healthPayload.steps = stepsN;
      healthPayload.workoutDone = health.workoutDone;
      if (health.workoutType) healthPayload.workoutType = health.workoutType;
      if (workoutDurN) healthPayload.workoutDurationMin = workoutDurN;

      const hasHealthData = sleepH || health.sleepQuality || energyL || health.mood || weightK || bodyFatP || health.stressLevel || stepsN || health.workoutDone;
      if (hasHealthData) {
        if (healthEntryId) {
          await apiRequest("PATCH", `/api/health/${healthEntryId}`, healthPayload);
        } else {
          await apiRequest("POST", "/api/health", healthPayload);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/days"] });
      queryClient.invalidateQueries({ queryKey: ["/api/health"] });
      toast({ title: "Saved", description: "Your daily log has been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save. Please try again.", variant: "destructive" });
    },
  });

  // ---- AUTO-SAVE (debounced) ----

  const debouncedSave = useDebouncedCallback(() => {
    saveMutation.mutate();
  }, 2000);

  // ---- COMPUTED ----

  const completedCount = enabledHabits.filter((h) => rituals[h.key]?.done).length;
  const progressPercent = enabledHabits.length > 0 ? (completedCount / enabledHabits.length) * 100 : 0;
  const completedOutcomes = top3Outcomes.filter((o) => o.completed && o.text.trim()).length;
  const totalOutcomes = top3Outcomes.filter((o) => o.text.trim()).length;

  const fastingH = typeof evening.fastingHours === "string" ? parseFloat(evening.fastingHours) || 0 : evening.fastingHours;
  const deepWorkH = typeof evening.deepWorkHours === "string" ? parseFloat(evening.deepWorkHours) || 0 : evening.deepWorkHours;

  // Section completion tracking
  const habitsComplete = enabledHabits.length > 0 && isAllRitualsComplete();
  const healthComplete = !!(health.sleepHours && health.sleepQuality && health.energyLevel);
  const planComplete = !!(top3Outcomes.some((o) => o.text.trim()) && planning.oneThingToShip);
  const mealsLogged = mealCount > 0;
  const eveningComplete = !!evening.reflectionPm;

  const sectionsCompleted = [habitsComplete, healthComplete, planComplete, mealsLogged, eveningComplete].filter(Boolean).length;

  // ---- LOADING ----

  if (isDayLoading || isConfigLoading) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="space-y-6">
          <div className="h-20 bg-muted animate-pulse rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="h-48 bg-muted animate-pulse rounded-lg" />
              <div className="h-64 bg-muted animate-pulse rounded-lg" />
            </div>
            <div className="space-y-4">
              <div className="h-48 bg-muted animate-pulse rounded-lg" />
              <div className="h-64 bg-muted animate-pulse rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- RENDER ----

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-7xl space-y-5">
      {/* ================================================================ */}
      {/* HEADER                                                           */}
      {/* ================================================================ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/10 rounded-xl shrink-0">
            <Sun className="h-7 w-7 text-amber-500" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Today</h1>
              <Badge variant="outline" className="text-[10px] font-mono tabular-nums">
                {sectionsCompleted}/5
              </Badge>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={goToPreviousDay} title="Previous day">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-medium">{format(currentDate, "EEEE, MMMM d")}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={goToNextDay} disabled={isViewingToday} title="Next day">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {!isViewingToday && (
                <Button variant="outline" size="sm" className="h-6 text-xs ml-1" onClick={goToToday}>
                  <Calendar className="h-3 w-3 mr-1" />
                  Today
                </Button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!isViewingToday && (
            <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-blue-500/20">
              Past Day
            </Badge>
          )}
          <Button variant="outline" size="icon" className="h-8 w-8" asChild>
            <Link href="/settings">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} size="sm" className="h-8 px-4 font-semibold">
            {saveMutation.isPending ? "Saving..." : "Save All"}
          </Button>
        </div>
      </div>

      {/* Section completion bar */}
      <div className="flex gap-1.5">
        {[
          { done: habitsComplete, label: "Habits", color: "bg-orange-500" },
          { done: healthComplete, label: "Health", color: "bg-rose-500" },
          { done: planComplete, label: "Plan", color: "bg-blue-500" },
          { done: mealsLogged, label: "Meals", color: "bg-green-500" },
          { done: eveningComplete, label: "Review", color: "bg-indigo-500" },
        ].map((s) => (
          <div key={s.label} className="flex-1">
            <div className={`h-1.5 rounded-full transition-colors ${s.done ? s.color : "bg-muted"}`} />
            <p className={`text-[10px] text-center mt-1 ${s.done ? "text-foreground font-medium" : "text-muted-foreground"}`}>
              {s.label}
            </p>
          </div>
        ))}
      </div>

      {/* ================================================================ */}
      {/* TWO-COLUMN GRID                                                  */}
      {/* ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ============================================================ */}
        {/* LEFT COLUMN: BODY & HABITS                                    */}
        {/* ============================================================ */}
        <div className="space-y-5">
          {/* ---- MORNING HABITS ---- */}
          {enabledHabits.length > 0 && (
            <Card className="border-orange-500/20">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base font-bold">
                    <Dumbbell className="h-4 w-4 text-orange-500" />
                    Morning Habits
                  </CardTitle>
                  <Badge
                    variant="outline"
                    className={completedCount === enabledHabits.length
                      ? "bg-green-500/10 text-green-400 border-green-500/20"
                      : "text-muted-foreground"
                    }
                  >
                    {completedCount}/{enabledHabits.length}
                  </Badge>
                </div>
                <Progress value={progressPercent} className="h-1.5 mt-2" />
              </CardHeader>
              {!isAllRitualsComplete() && (
                <div className="px-6 pb-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-xs"
                    onClick={() => {
                      const allDone: Record<string, { done: boolean }> = {};
                      for (const habit of enabledHabits) {
                        allDone[habit.key] = { done: true };
                      }
                      setRituals(allDone);
                    }}
                  >
                    <CheckCircle2 className="h-3 w-3 mr-1.5" />
                    Mark All Done
                  </Button>
                </div>
              )}
              <CardContent className="space-y-2">
                {enabledHabits.map((habit) => {
                  const Icon = getIconComponent(habit.icon);
                  const isComplete = rituals[habit.key]?.done;

                  return (
                    <div
                      key={habit.key}
                      className={`flex items-center justify-between p-2.5 rounded-lg border transition-all ${
                        isComplete
                          ? "bg-green-500/5 border-green-500/20"
                          : "bg-muted/30 border-border/50 hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Checkbox
                          id={habit.key}
                          checked={isComplete}
                          onCheckedChange={() => toggleHabit(habit.key)}
                          className="h-5 w-5"
                        />
                        <Icon className={`h-4 w-4 ${isComplete ? "text-green-500" : "text-muted-foreground"}`} />
                        <Label
                          htmlFor={habit.key}
                          className={`cursor-pointer text-sm ${isComplete ? "line-through text-muted-foreground" : ""}`}
                        >
                          {habit.label}
                        </Label>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* ---- HEALTH METRICS ---- */}
          <Card className="border-rose-500/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <Heart className="h-4 w-4 text-rose-500" />
                  Health Metrics
                </CardTitle>
                {healthComplete && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Logged
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* Sleep Hours */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Sleep (hrs)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={16}
                    step={0.5}
                    placeholder="7.5"
                    value={health.sleepHours}
                    onChange={(e) => setHealth({ ...health, sleepHours: e.target.value })}
                    onBlur={debouncedSave}
                    className="h-9"
                  />
                </div>

                {/* Sleep Quality */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Quality</Label>
                  <Select value={health.sleepQuality} onValueChange={(v) => { setHealth({ ...health, sleepQuality: v }); debouncedSave(); }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="poor">Poor</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="excellent">Excellent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Energy Level */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Energy</Label>
                  <Select
                    value={String(health.energyLevel || "")}
                    onValueChange={(v) => { setHealth({ ...health, energyLevel: v }); debouncedSave(); }}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="1-5" /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n === 1 ? "1 - Drained" : n === 2 ? "2 - Low" : n === 3 ? "3 - Okay" : n === 4 ? "4 - Good" : "5 - Peak"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Mood */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Mood</Label>
                  <Select value={health.mood} onValueChange={(v) => { setHealth({ ...health, mood: v }); debouncedSave(); }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="peak">Peak</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Weight */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Weight (kg)</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    placeholder="82"
                    value={health.weightKg}
                    onChange={(e) => setHealth({ ...health, weightKg: e.target.value })}
                    onBlur={debouncedSave}
                    className="h-9"
                  />
                </div>

                {/* Stress Level */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Stress</Label>
                  <Select value={health.stressLevel} onValueChange={(v) => { setHealth({ ...health, stressLevel: v }); debouncedSave(); }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Steps */}
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Steps</Label>
                  <Input
                    type="number"
                    min={0}
                    placeholder="8000"
                    value={health.steps}
                    onChange={(e) => setHealth({ ...health, steps: e.target.value })}
                    onBlur={debouncedSave}
                    className="h-9"
                  />
                </div>
              </div>

              {/* Workout Toggle */}
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Dumbbell className={`h-4 w-4 ${health.workoutDone ? "text-green-500" : "text-muted-foreground"}`} />
                    <Label className="text-sm font-medium">Workout</Label>
                  </div>
                  <Switch
                    checked={health.workoutDone}
                    onCheckedChange={(v) => { setHealth({ ...health, workoutDone: v }); }}
                  />
                </div>
                {health.workoutDone && (
                  <div className="grid grid-cols-2 gap-3 pl-6">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Type</Label>
                      <Select value={health.workoutType} onValueChange={(v) => setHealth({ ...health, workoutType: v })}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Type..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="strength">Strength</SelectItem>
                          <SelectItem value="cardio">Cardio</SelectItem>
                          <SelectItem value="yoga">Yoga</SelectItem>
                          <SelectItem value="sports">Sports</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground uppercase tracking-wider">Duration</Label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={0}
                          placeholder="45"
                          value={health.workoutDurationMin}
                          onChange={(e) => setHealth({ ...health, workoutDurationMin: e.target.value })}
                          className="h-9"
                        />
                        <span className="text-xs text-muted-foreground">min</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ---- EVENING REVIEW ---- */}
          <Card className="border-indigo-500/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <Moon className="h-4 w-4 text-indigo-500" />
                  Evening Review
                </CardTitle>
                {eveningComplete && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Done
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Fasting + Deep Work */}
              <div className="grid grid-cols-2 gap-4">
                {/* Fasting Hours */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Utensils className="h-3.5 w-3.5 text-orange-500" />
                      <Label className="text-xs font-semibold">Fasting</Label>
                    </div>
                    <span className="text-[10px] text-muted-foreground">16h goal</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      placeholder="0"
                      value={evening.fastingHours}
                      onChange={(e) => setEvening({ ...evening, fastingHours: e.target.value })}
                      className="w-16 h-8 text-center text-sm"
                    />
                    <span className="text-xs text-muted-foreground">hrs</span>
                    {fastingH >= 16 && (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    )}
                  </div>
                  <Progress
                    value={Math.min((fastingH / 16) * 100, 100)}
                    className={`h-1 ${fastingH >= 16 ? "[&>div]:bg-green-500" : "[&>div]:bg-orange-500"}`}
                  />
                </div>

                {/* Deep Work Hours */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Timer className="h-3.5 w-3.5 text-purple-500" />
                      <Label className="text-xs font-semibold">Deep Work</Label>
                    </div>
                    <span className="text-[10px] text-muted-foreground">5h goal</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={12}
                      step={0.5}
                      placeholder="0"
                      value={evening.deepWorkHours}
                      onChange={(e) => setEvening({ ...evening, deepWorkHours: e.target.value })}
                      className="w-16 h-8 text-center text-sm"
                    />
                    <span className="text-xs text-muted-foreground">hrs</span>
                    {deepWorkH >= 5 && (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    )}
                  </div>
                  <Progress
                    value={Math.min((deepWorkH / 5) * 100, 100)}
                    className={`h-1 ${deepWorkH >= 5 ? "[&>div]:bg-green-500" : "[&>div]:bg-purple-500"}`}
                  />
                </div>
              </div>

              <Separator />

              {/* Journal & Reflection */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Journal & Reflection</Label>
                <Textarea
                  placeholder="What went well? What could improve? Lessons learned, gratitude, free-form thoughts..."
                  value={evening.reflectionPm}
                  onChange={(e) => setEvening({ ...evening, reflectionPm: e.target.value })}
                  rows={4}
                  className="text-sm resize-none"
                />
              </div>

              {/* Day Summary */}
              {totalTasks > 0 && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center p-2.5 bg-muted/50 rounded-lg">
                      <div className="text-xl font-bold text-blue-400">{completedTasks}/{totalTasks}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Tasks Done</div>
                      <Progress value={taskCompletionRate} className="h-1 mt-1.5" />
                    </div>
                    <div className="text-center p-2.5 bg-muted/50 rounded-lg">
                      <div className="text-xl font-bold text-purple-400">{completedOutcomes}/{totalOutcomes || 3}</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Outcomes Hit</div>
                      <Progress value={totalOutcomes > 0 ? (completedOutcomes / totalOutcomes) * 100 : 0} className="h-1 mt-1.5" />
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ============================================================ */}
        {/* RIGHT COLUMN: MIND & EXECUTION                                */}
        {/* ============================================================ */}
        <div className="space-y-5">
          {/* ---- DAY PLAN ---- */}
          <Card className="border-blue-500/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <Target className="h-4 w-4 text-blue-500" />
                  Day Plan
                </CardTitle>
                {planComplete && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px]">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Set
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Venture Focus */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <Label className="text-xs font-semibold">Venture Focus</Label>
                </div>
                <Select
                  value={planning.primaryVentureFocus}
                  onValueChange={(value) => setPlanning({ ...planning, primaryVentureFocus: value })}
                >
                  <SelectTrigger className="h-9"><SelectValue placeholder="Select venture..." /></SelectTrigger>
                  <SelectContent>
                    {activeVentures.map((venture) => (
                      <SelectItem key={venture.id} value={venture.id}>
                        <span className="flex items-center gap-2">
                          {venture.icon && <span>{venture.icon}</span>}
                          {venture.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* One Thing to Ship */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Rocket className="h-3.5 w-3.5 text-purple-500" />
                  <Label className="text-xs font-semibold">One Thing to Ship</Label>
                </div>
                {priorityTasksDueToday.length > 0 ? (
                  <Select
                    value={planning.oneThingToShip}
                    onValueChange={(value) => setPlanning({ ...planning, oneThingToShip: value })}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="Pick your one thing..." /></SelectTrigger>
                    <SelectContent>
                      {priorityTasksDueToday.map((task) => (
                        <SelectItem key={task.id} value={task.title}>
                          <span className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                task.priority === "P0"
                                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                                  : "bg-orange-500/10 text-orange-400 border-orange-500/20"
                              }
                            >
                              {task.priority}
                            </Badge>
                            {task.title}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="What must you ship today?"
                    value={planning.oneThingToShip}
                    onChange={(e) => setPlanning({ ...planning, oneThingToShip: e.target.value })}
                    className="h-9"
                  />
                )}
              </div>

              {/* Top 3 Outcomes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-blue-500" />
                    <Label className="text-xs font-semibold">Top 3 Outcomes</Label>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{completedOutcomes}/{totalOutcomes || 3} done</span>
                </div>
                {top3Outcomes.map((outcome, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-2.5 p-2 rounded-lg border transition-all ${
                      outcome.completed && outcome.text.trim()
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-muted/20 border-border/50"
                    }`}
                  >
                    <Checkbox
                      id={`outcome-${index}`}
                      checked={outcome.completed}
                      onCheckedChange={() => toggleOutcomeCompleted(index)}
                      disabled={!outcome.text.trim()}
                      className="h-4 w-4"
                    />
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                        index === 0
                          ? "bg-purple-500/15 text-purple-400"
                          : index === 1
                          ? "bg-blue-500/15 text-blue-400"
                          : "bg-slate-500/15 text-slate-400"
                      }`}
                    >
                      {index + 1}
                    </div>
                    <Input
                      placeholder={index === 0 ? "Most important outcome..." : `Outcome ${index + 1}...`}
                      value={outcome.text}
                      onChange={(e) => updateOutcomeText(index, e.target.value)}
                      className={`flex-1 h-8 text-sm border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 ${
                        outcome.completed ? "line-through text-muted-foreground" : ""
                      }`}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ---- MEALS ---- */}
          <Card className="border-green-500/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <Apple className="h-4 w-4 text-green-500" />
                  Meals
                </CardTitle>
                <div className="flex items-center gap-2">
                  {mealCount > 0 && (
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className="flex items-center gap-1 text-orange-400">
                        <Flame className="h-3 w-3" />
                        {Math.round(totalCalories)} cal
                      </span>
                      <span className="flex items-center gap-1 text-blue-400">
                        <Beef className="h-3 w-3" />
                        {Math.round(totalProtein)}g
                      </span>
                    </div>
                  )}
                  <Badge variant="outline" className="text-[10px]">
                    {mealCount} meals
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Daily Nutrition Checkboxes */}
              <div className="flex items-center gap-6 p-2.5 rounded-lg bg-muted/30 border border-border/50">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="protein-met"
                    checked={proteinMet}
                    onCheckedChange={(checked) => setProteinMet(!!checked)}
                  />
                  <Label htmlFor="protein-met" className="text-xs cursor-pointer flex items-center gap-1.5">
                    <Beef className="h-3.5 w-3.5 text-blue-400" />
                    Protein Hit
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="calories-over"
                    checked={caloriesOver2100}
                    onCheckedChange={(checked) => setCaloriesOver2100(!!checked)}
                  />
                  <Label htmlFor="calories-over" className="text-xs cursor-pointer flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 text-orange-400" />
                    2100+ Cal
                  </Label>
                </div>
              </div>

              {/* Add Meal Form */}
              <div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={newMeal.mealType} onValueChange={(v) => setNewMeal({ ...newMeal, mealType: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Meal type..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="breakfast">Breakfast</SelectItem>
                      <SelectItem value="lunch">Lunch</SelectItem>
                      <SelectItem value="dinner">Dinner</SelectItem>
                      <SelectItem value="snack">Snack</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Description..."
                    value={newMeal.description}
                    onChange={(e) => setNewMeal({ ...newMeal, description: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    placeholder="Calories"
                    value={newMeal.calories}
                    onChange={(e) => setNewMeal({ ...newMeal, calories: e.target.value })}
                    className="h-8 text-xs flex-1"
                  />
                  <Input
                    type="number"
                    min={0}
                    placeholder="Protein (g)"
                    value={newMeal.proteinG}
                    onChange={(e) => setNewMeal({ ...newMeal, proteinG: e.target.value })}
                    className="h-8 text-xs flex-1"
                  />
                  <Button
                    size="sm"
                    className="h-8 px-3"
                    disabled={!newMeal.mealType || !newMeal.description || addMealMutation.isPending}
                    onClick={() => addMealMutation.mutate()}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </div>
              </div>

              {/* Meals List */}
              {isNutritionLoading ? (
                <div className="h-16 bg-muted animate-pulse rounded-lg" />
              ) : Array.isArray(nutritionEntries) && nutritionEntries.length > 0 ? (
                <div className="space-y-1.5">
                  {nutritionEntries.map((meal) => (
                    <div
                      key={meal.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/20 border border-border/30 group"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Badge
                          variant="outline"
                          className={`text-[9px] shrink-0 ${
                            meal.mealType === "breakfast"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : meal.mealType === "lunch"
                              ? "bg-green-500/10 text-green-400 border-green-500/20"
                              : meal.mealType === "dinner"
                              ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                              : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                          }`}
                        >
                          {meal.mealType}
                        </Badge>
                        <span className="text-sm truncate">{meal.description}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        {meal.calories && (
                          <span className="text-[10px] text-orange-400 tabular-nums">{Math.round(meal.calories)} cal</span>
                        )}
                        {meal.proteinG && (
                          <span className="text-[10px] text-blue-400 tabular-nums">{Math.round(meal.proteinG)}g</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          onClick={() => deleteMealMutation.mutate(meal.id)}
                          disabled={deleteMealMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {/* Running Totals */}
                  <div className="flex items-center justify-end gap-4 pt-1 pr-8">
                    <span className="text-xs font-semibold text-orange-400 tabular-nums">
                      Total: {Math.round(totalCalories)} cal
                    </span>
                    <span className="text-xs font-semibold text-blue-400 tabular-nums">
                      {Math.round(totalProtein)}g protein
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-3">No meals logged yet. Add one above.</p>
              )}
            </CardContent>
          </Card>

          {/* ---- ONE THING STATUS ---- */}
          {dayData?.oneThingToShip && (
            <Card className="border-purple-500/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Rocket className="h-4 w-4 text-purple-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-400">Ship It</span>
                </div>
                <p className="text-sm font-medium">{dayData.oneThingToShip}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ================================================================ */}
      {/* BOTTOM SAVE BAR (mobile)                                         */}
      {/* ================================================================ */}
      <div className="flex justify-center pb-4 lg:hidden">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="w-full font-semibold"
        >
          {saveMutation.isPending ? "Saving..." : "Save All"}
        </Button>
      </div>
    </div>
  );
}
