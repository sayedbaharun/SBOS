import MetricTrendChart from "./metric-trend-chart";
import {
  getSleepStatus,
  getRhrStatus,
  getHrvStatus,
  getStepsStatus,
  getStrainStatus,
  getWorkoutStatus,
} from "./health-thresholds";
import type { HealthEntry } from "./hero-metrics-strip";

interface MetricTrendsSectionProps {
  entries: HealthEntry[];
}

export default function MetricTrendsSection({ entries }: MetricTrendsSectionProps) {
  // Sort ascending for chart display (oldest → newest)
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  const sleep  = sorted.map(e => ({ date: e.date, value: e.sleepHours }));
  const rhr    = sorted.map(e => ({ date: e.date, value: e.restingHeartRate }));
  const hrv    = sorted.map(e => ({ date: e.date, value: e.hrv !== null ? Math.round(e.hrv) : null }));
  const steps  = sorted.map(e => ({ date: e.date, value: e.steps }));
  const strain = sorted.map(e => ({ date: e.date, value: e.strainScore !== null ? parseFloat(e.strainScore.toFixed(1)) : null }));
  const workout = sorted.map(e => ({ date: e.date, value: e.workoutDone ? 1 : 0 }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <MetricTrendChart
        data={sleep}
        label="Sleep"
        unit="hrs"
        chartType="line"
        thresholdGreen={7}
        thresholdAmber={6}
        domain={[4, 10]}
        getStatus={getSleepStatus}
      />

      <MetricTrendChart
        data={rhr}
        label="Resting Heart Rate"
        unit="bpm"
        chartType="line"
        thresholdGreen={55}
        thresholdAmber={65}
        domain={[40, 80]}
        getStatus={getRhrStatus}
      />

      <MetricTrendChart
        data={hrv}
        label="HRV"
        unit="ms"
        chartType="line"
        thresholdGreen={60}
        thresholdAmber={40}
        domain={[20, 120]}
        getStatus={getHrvStatus}
      />

      <MetricTrendChart
        data={steps}
        label="Steps"
        unit="steps"
        chartType="bar"
        thresholdGreen={10000}
        thresholdAmber={7000}
        getStatus={getStepsStatus}
      />

      <MetricTrendChart
        data={strain}
        label="Strain"
        unit="/ 21"
        chartType="line"
        thresholdGreen={10}
        thresholdAmber={5}
        domain={[0, 21]}
        getStatus={getStrainStatus}
      />

      <MetricTrendChart
        data={workout}
        label="Workouts"
        unit=""
        chartType="bar"
        binaryMode={true}
        getStatus={v => getWorkoutStatus(v === 1)}
      />
    </div>
  );
}
