import { TrendingUp, TrendingDown, Minus, Moon, Heart, Activity, Footprints, Zap, Dumbbell } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getSleepStatus,
  getRhrStatus,
  getHrvStatus,
  getStepsStatus,
  getStrainStatus,
  getWorkoutStatus,
  STATUS_CLASSES,
  type MetricStatus,
} from "./health-thresholds";

export interface HealthEntry {
  id: string;
  dayId: string;
  date: string;
  sleepHours: number | null;
  sleepQuality: string | null;
  energyLevel: number | null;
  mood: string | null;
  steps: number | null;
  workoutDone: boolean;
  workoutType: string | null;
  workoutDurationMin: number | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  stressLevel: string | null;
  notes: string | null;
  recoveryScore: number | null;
  hrv: number | null;
  restingHeartRate: number | null;
  strainScore: number | null;
  whoopSyncedAt: string | null;
}

interface MetricCardProps {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  status: MetricStatus;
  trend?: "up" | "down" | "flat" | null;
  trendLabel?: string;
}

function MetricCard({ label, value, subValue, icon, status, trend, trendLabel }: MetricCardProps) {
  const s = STATUS_CLASSES[status];

  const TrendIcon =
    trend === "up" ? TrendingUp :
    trend === "down" ? TrendingDown :
    Minus;

  const trendColor =
    trend === "up" ? "text-emerald-400" :
    trend === "down" ? "text-rose-400" :
    "text-muted-foreground";

  return (
    <div className={cn("rounded-xl border p-4 flex flex-col gap-2", s.bg, s.border)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className={cn("opacity-60", s.text)}>{icon}</span>
      </div>

      <div className="flex flex-col">
        <span className={cn("text-2xl font-bold leading-none", status === "neutral" ? "text-muted-foreground" : "text-foreground")}>
          {value}
        </span>
        {subValue && (
          <span className="text-xs text-muted-foreground mt-0.5">{subValue}</span>
        )}
      </div>

      {(trendLabel || trend) && (
        <div className={cn("flex items-center gap-1 text-xs", trendColor)}>
          <TrendIcon className="h-3 w-3" />
          <span>{trendLabel ?? ""}</span>
        </div>
      )}

      <div className="flex items-center gap-1.5 mt-auto">
        <div className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
        <span className={cn("text-xs capitalize", s.text)}>
          {status === "neutral" ? "no data" : status}
        </span>
      </div>
    </div>
  );
}

function avg(arr: (number | null)[]): number | null {
  const valid = arr.filter((v): v is number => v !== null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function trend(current: number | null, reference: number | null): "up" | "down" | "flat" | null {
  if (current === null || reference === null) return null;
  const delta = current - reference;
  if (Math.abs(delta) < 0.5) return "flat";
  return delta > 0 ? "up" : "down";
}

function trendSign(current: number | null, reference: number | null, unit = ""): string {
  if (current === null || reference === null) return "";
  const delta = current - reference;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}${unit} vs avg`;
}

interface HeroMetricsStripProps {
  entries: HealthEntry[];
}

export default function HeroMetricsStrip({ entries }: HeroMetricsStripProps) {
  // Sort desc by date, most recent first
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0] ?? null;

  // 7-day average from all entries (they're already date-filtered by the parent)
  const sevenDay = sorted.slice(0, 7);

  const avgSleep = avg(sevenDay.map(e => e.sleepHours));
  const avgRhr   = avg(sevenDay.map(e => e.restingHeartRate));
  const avgHrv   = avg(sevenDay.map(e => e.hrv));
  const avgSteps = avg(sevenDay.map(e => e.steps));
  const avgStrain = avg(sevenDay.map(e => e.strainScore));

  // Workout: how many days in the period had a workout
  const workoutDays = sevenDay.filter(e => e.workoutDone).length;
  const workoutFraction = `${workoutDays}/${sevenDay.length}d`;

  const sleep  = latest?.sleepHours ?? null;
  const rhr    = latest?.restingHeartRate ?? null;
  const hrv    = latest?.hrv ?? null;
  const steps  = latest?.steps ?? null;
  const strain = latest?.strainScore ?? null;
  const worked = latest?.workoutDone ?? false;
  const wType  = latest?.workoutType ?? null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {/* Sleep */}
      <MetricCard
        label="Sleep"
        value={sleep !== null ? `${sleep}h` : "—"}
        subValue={latest?.sleepQuality ?? undefined}
        icon={<Moon className="h-4 w-4" />}
        status={getSleepStatus(sleep)}
        trend={trend(sleep, avgSleep)}
        trendLabel={trendSign(sleep, avgSleep, "h")}
      />

      {/* RHR */}
      <MetricCard
        label="RHR"
        value={rhr !== null ? `${rhr}` : "—"}
        subValue={rhr !== null ? "bpm" : undefined}
        icon={<Heart className="h-4 w-4" />}
        status={getRhrStatus(rhr)}
        trend={rhr !== null && avgRhr !== null ? (rhr < avgRhr ? "up" : rhr > avgRhr ? "down" : "flat") : null}
        trendLabel={rhr !== null && avgRhr !== null ? `${rhr < avgRhr ? "" : "+"}${(rhr - avgRhr).toFixed(0)} vs avg` : ""}
      />

      {/* HRV */}
      <MetricCard
        label="HRV"
        value={hrv !== null ? `${Math.round(hrv)}` : "—"}
        subValue={hrv !== null ? "ms" : undefined}
        icon={<Activity className="h-4 w-4" />}
        status={getHrvStatus(hrv)}
        trend={trend(hrv, avgHrv)}
        trendLabel={trendSign(hrv, avgHrv, "ms")}
      />

      {/* Steps */}
      <MetricCard
        label="Steps"
        value={steps !== null ? steps >= 1000 ? `${(steps / 1000).toFixed(1)}k` : `${steps}` : "—"}
        icon={<Footprints className="h-4 w-4" />}
        status={getStepsStatus(steps)}
        trend={trend(steps, avgSteps)}
        trendLabel={steps !== null && avgSteps !== null ? `${steps > avgSteps ? "+" : ""}${((steps - avgSteps) / 1000).toFixed(1)}k vs avg` : ""}
      />

      {/* Strain */}
      <MetricCard
        label="Strain"
        value={strain !== null ? strain.toFixed(1) : "—"}
        subValue={strain !== null ? "/ 21" : undefined}
        icon={<Zap className="h-4 w-4" />}
        status={getStrainStatus(strain)}
        trend={trend(strain, avgStrain)}
        trendLabel={trendSign(strain, avgStrain)}
      />

      {/* Workout */}
      <MetricCard
        label="Workout"
        value={latest ? (worked ? "Done" : "Rest") : "—"}
        subValue={worked && wType ? wType : workoutFraction}
        icon={<Dumbbell className="h-4 w-4" />}
        status={latest ? getWorkoutStatus(worked) : "neutral"}
        trend={null}
        trendLabel={`${workoutDays}/${sevenDay.length} days`}
      />
    </div>
  );
}
