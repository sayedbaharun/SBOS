import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { subDays, format } from "date-fns";
import { Heart, Activity, FlaskConical, Apple } from "lucide-react";
import HealthHubHeader from "@/components/health-hub/health-hub-header";
import HeroMetricsStrip, { type HealthEntry } from "@/components/health-hub/hero-metrics-strip";
import MetricTrendsSection from "@/components/health-hub/metric-trends-section";
import WeightTrendCard from "@/components/health-hub/weight-trend-card";
import DayDetailModal from "@/components/health-hub/day-detail-modal";
import QuickLogModal from "@/components/health-hub/quick-log-modal";
import EditHealthEntryModal from "@/components/health-hub/edit-health-entry-modal";
import BloodworkTab from "@/components/health-hub/bloodwork-tab";
import NutritionDashboardHeader from "@/components/nutrition-dashboard/nutrition-dashboard-header";
import TodaysMeals from "@/components/nutrition-dashboard/todays-meals";
import NutritionGoals from "@/components/nutrition-dashboard/nutrition-goals";
import WeeklySummary from "@/components/nutrition-dashboard/weekly-summary";
import MealHistory from "@/components/nutrition-dashboard/meal-history";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

interface NutritionEntry {
  id: string;
  dayId: string;
  datetime: string;
  mealType: string;
  description: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatsG: number | null;
  context: string | null;
  tags: string[] | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function HealthHub() {
  const [dateRange, setDateRange] = useState("7");
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [editEntryOpen, setEditEntryOpen] = useState(false);
  const [dayDetailOpen, setDayDetailOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<HealthEntry | null>(null);
  const [nutritionGoalsUpdateTrigger, setNutritionGoalsUpdateTrigger] = useState(0);

  // Calculate date range
  const getDateRange = () => {
    const today = new Date();
    switch (dateRange) {
      case "7":
        return { start: subDays(today, 7), end: today };
      case "30":
        return { start: subDays(today, 30), end: today };
      case "90":
        return { start: subDays(today, 90), end: today };
      default:
        return { start: new Date(2020, 0, 1), end: today };
    }
  };

  const { start: startDate, end: endDate } = getDateRange();

  // Fetch health entries
  const { data: healthEntries = [], isLoading } = useQuery<HealthEntry[]>({
    queryKey: ["/api/health"],
  });

  // Fetch nutrition entries
  const { data: nutritionEntries = [] } = useQuery<NutritionEntry[]>({
    queryKey: ["/api/nutrition"],
  });

  const nutritionArray = Array.isArray(nutritionEntries) ? nutritionEntries : [];
  const nutritionToday = format(new Date(), "yyyy-MM-dd");
  const nutritionWeekAgo = format(subDays(new Date(), 6), "yyyy-MM-dd");

  const nutritionTodaysMeals = nutritionArray.filter((meal) => {
    const mealDate = format(new Date(meal.datetime), "yyyy-MM-dd");
    return mealDate === nutritionToday;
  });

  const nutritionWeekMeals = nutritionArray.filter((meal) => {
    const mealDate = format(new Date(meal.datetime), "yyyy-MM-dd");
    return mealDate >= nutritionWeekAgo && mealDate <= nutritionToday;
  });

  const nutritionTodaysTotals = {
    calories: nutritionTodaysMeals.reduce((sum, m) => sum + (m.calories || 0), 0),
    protein: nutritionTodaysMeals.reduce((sum, m) => sum + (m.proteinG || 0), 0),
    carbs: nutritionTodaysMeals.reduce((sum, m) => sum + (m.carbsG || 0), 0),
    fats: nutritionTodaysMeals.reduce((sum, m) => sum + (m.fatsG || 0), 0),
  };

  const handleNutritionGoalsUpdated = () => {
    setNutritionGoalsUpdateTrigger((prev) => prev + 1);
  };

  const entriesArray = Array.isArray(healthEntries) ? healthEntries : [];

  // Filter by selected date range
  const filteredEntries = entriesArray.filter((entry) => {
    const entryDate = new Date(entry.date);
    return entryDate >= startDate && entryDate <= endDate;
  });

  const selectedEntry = selectedDate
    ? entriesArray.find((e) => e.date === selectedDate) ?? null
    : null;

  const handleEditEntry = (entry: HealthEntry) => {
    setEditingEntry(entry);
    setEditEntryOpen(true);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Heart className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight">Health & Performance</h1>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-36 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Page title */}
      <div className="flex items-center gap-3">
        <Heart className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold tracking-tight">Health & Performance</h1>
      </div>

      <Tabs defaultValue="daily" className="space-y-6">
        <TabsList>
          <TabsTrigger value="daily" className="gap-2">
            <Activity className="h-4 w-4" />
            Daily Health
          </TabsTrigger>
          <TabsTrigger value="nutrition" className="gap-2">
            <Apple className="h-4 w-4" />
            Nutrition
          </TabsTrigger>
          <TabsTrigger value="bloodwork" className="gap-2">
            <FlaskConical className="h-4 w-4" />
            Bloodwork
          </TabsTrigger>
        </TabsList>

        {/* ── Daily Health Tab ── */}
        <TabsContent value="daily" className="space-y-6">
          {/* Controls: date range + WHOOP sync + log */}
          <HealthHubHeader
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            onOpenQuickLog={() => setQuickLogOpen(true)}
            hideTitle={true}
          />

          {filteredEntries.length === 0 ? (
            <div className="text-center py-20">
              <Heart className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-40" />
              <h2 className="text-xl font-semibold mb-2">No health data in this range</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Sync WHOOP or log a day manually to see your metrics here.
              </p>
              <Button onClick={() => setQuickLogOpen(true)}>Log Today</Button>
            </div>
          ) : (
            <>
              {/* Hero: 6 priority metrics */}
              <HeroMetricsStrip entries={filteredEntries} />

              {/* Trend sparklines for each metric */}
              <MetricTrendsSection entries={filteredEntries} />

              {/* Weight trend from Google Drive CSV */}
              <WeightTrendCard />
            </>
          )}
        </TabsContent>

        {/* ── Nutrition Tab ── */}
        <TabsContent value="nutrition" className="space-y-6">
          <NutritionDashboardHeader
            dateFilter="today"
            onDateFilterChange={() => {}}
            onGoalsUpdated={handleNutritionGoalsUpdated}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <TodaysMeals meals={nutritionTodaysMeals} key={nutritionGoalsUpdateTrigger} />
            </div>
            <div>
              <NutritionGoals
                totals={nutritionTodaysTotals}
                onGoalsUpdated={handleNutritionGoalsUpdated}
                key={nutritionGoalsUpdateTrigger}
              />
            </div>
          </div>

          <WeeklySummary meals={nutritionWeekMeals} />
          <MealHistory meals={nutritionEntries} />
        </TabsContent>

        {/* ── Bloodwork Tab ── */}
        <TabsContent value="bloodwork">
          <BloodworkTab />
        </TabsContent>
      </Tabs>

      {/* Modals — unchanged */}
      <QuickLogModal open={quickLogOpen} onOpenChange={setQuickLogOpen} />

      <EditHealthEntryModal
        open={editEntryOpen}
        onOpenChange={setEditEntryOpen}
        entry={editingEntry}
      />

      <DayDetailModal
        open={dayDetailOpen}
        onOpenChange={setDayDetailOpen}
        date={selectedDate}
        healthEntry={selectedEntry}
        onEdit={(entry) => {
          setDayDetailOpen(false);
          handleEditEntry(entry as unknown as HealthEntry);
        }}
      />
    </div>
  );
}
