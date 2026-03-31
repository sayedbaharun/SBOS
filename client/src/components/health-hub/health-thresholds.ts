export type MetricStatus = "green" | "amber" | "red" | "neutral";

export const HEALTH_THRESHOLDS = {
  sleep:   { green: 7.0,   amber: 6.0 },   // hours; lower is worse
  rhr:     { green: 55,    amber: 65 },     // bpm;  INVERTED — lower is better
  hrv:     { green: 60,    amber: 40 },     // ms;   higher is better
  steps:   { green: 10000, amber: 7000 },   // steps
  strain:  { greenMin: 10, greenMax: 18, amberMin: 5 }, // WHOOP 0-21 band
} as const;

export function getSleepStatus(val: number | null): MetricStatus {
  if (val === null) return "neutral";
  if (val >= HEALTH_THRESHOLDS.sleep.green) return "green";
  if (val >= HEALTH_THRESHOLDS.sleep.amber) return "amber";
  return "red";
}

export function getRhrStatus(val: number | null): MetricStatus {
  if (val === null) return "neutral";
  if (val <= HEALTH_THRESHOLDS.rhr.green) return "green";
  if (val <= HEALTH_THRESHOLDS.rhr.amber) return "amber";
  return "red";
}

export function getHrvStatus(val: number | null): MetricStatus {
  if (val === null) return "neutral";
  if (val >= HEALTH_THRESHOLDS.hrv.green) return "green";
  if (val >= HEALTH_THRESHOLDS.hrv.amber) return "amber";
  return "red";
}

export function getStepsStatus(val: number | null): MetricStatus {
  if (val === null) return "neutral";
  if (val >= HEALTH_THRESHOLDS.steps.green) return "green";
  if (val >= HEALTH_THRESHOLDS.steps.amber) return "amber";
  return "red";
}

export function getStrainStatus(val: number | null): MetricStatus {
  if (val === null) return "neutral";
  const { greenMin, greenMax, amberMin } = HEALTH_THRESHOLDS.strain;
  if (val >= greenMin && val <= greenMax) return "green";
  if (val >= amberMin) return "amber";
  return "red";
}

export function getWorkoutStatus(done: boolean): MetricStatus {
  return done ? "green" : "red";
}

export const STATUS_CLASSES: Record<MetricStatus, { bg: string; border: string; text: string; dot: string }> = {
  green:   { bg: "bg-emerald-950/40", border: "border-emerald-500/30", text: "text-emerald-400", dot: "bg-emerald-400" },
  amber:   { bg: "bg-amber-950/40",   border: "border-amber-500/30",   text: "text-amber-400",   dot: "bg-amber-400" },
  red:     { bg: "bg-rose-950/40",    border: "border-rose-500/30",    text: "text-rose-400",    dot: "bg-rose-400" },
  neutral: { bg: "bg-muted/20",       border: "border-border",         text: "text-muted-foreground", dot: "bg-muted-foreground" },
};
