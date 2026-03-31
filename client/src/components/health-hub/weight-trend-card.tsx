import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Scale, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

interface WeightEntry {
  date: string;
  weightKg: number;
  bodyFatPct: number | null;
  leanBodyMassKg: number | null;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md space-y-1">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="text-xs">
          {p.name}: <span className="font-semibold">{p.value != null ? p.value : "—"}</span>
        </p>
      ))}
    </div>
  );
};

function DeltaBadge({ first, last, unit }: { first: number; last: number; unit: string }) {
  const delta = last - first;
  const sign = delta > 0 ? "+" : "";
  const color = delta < -0.3 ? "text-emerald-400" : delta > 0.3 ? "text-rose-400" : "text-muted-foreground";
  const Icon = delta < -0.3 ? TrendingDown : delta > 0.3 ? TrendingUp : Minus;
  return (
    <span className={`flex items-center gap-0.5 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {sign}{delta.toFixed(1)}{unit}
    </span>
  );
}

export default function WeightTrendCard() {
  const { data, isLoading, isError, error } = useQuery<WeightEntry[]>({
    queryKey: ["/api/health/weight-trend"],
    retry: 1,
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2 pt-4 px-4">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data || data.length === 0) {
    const msg = isError
      ? "Could not load weight data — check Google Drive is connected."
      : "No weight data yet. Upload a weight CSV to SB-OS/Knowledge Base/Health in Drive.";
    return (
      <Card className="border-border bg-muted/10">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Body Composition</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-muted-foreground">{msg}</p>
        </CardContent>
      </Card>
    );
  }

  const latest = data[data.length - 1];
  const first = data[0];

  const chartData = data.map(d => ({
    displayDate: format(parseISO(d.date), "MMM d"),
    "Weight (kg)": d.weightKg,
    "Body Fat %": d.bodyFatPct,
    "Lean Mass (kg)": d.leanBodyMassKg,
  }));

  const allWeights = data.map(d => d.weightKg);
  const minW = Math.min(...allWeights) - 2;
  const maxW = Math.max(...allWeights) + 2;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Body Composition</CardTitle>
            <span className="text-xs text-muted-foreground">(Google Drive)</span>
          </div>
          {/* Latest values + deltas */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Weight</p>
              <p className="text-xl font-bold leading-tight">{latest.weightKg} kg</p>
              <DeltaBadge first={first.weightKg} last={latest.weightKg} unit=" kg" />
            </div>
            {latest.bodyFatPct != null && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Body Fat</p>
                <p className="text-xl font-bold leading-tight">{latest.bodyFatPct}%</p>
                {first.bodyFatPct != null && (
                  <DeltaBadge first={first.bodyFatPct} last={latest.bodyFatPct} unit="%" />
                )}
              </div>
            )}
            {latest.leanBodyMassKg != null && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Lean Mass</p>
                <p className="text-xl font-bold leading-tight">{latest.leanBodyMassKg} kg</p>
                {first.leanBodyMassKg != null && (
                  <DeltaBadge first={first.leanBodyMassKg} last={latest.leanBodyMassKg} unit=" kg" />
                )}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-4">
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="weight"
              domain={[minW, maxW]}
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={[20, 50]}
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              width={30}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
            <Line
              yAxisId="weight"
              type="monotone"
              dataKey="Weight (kg)"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="Body Fat %"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="weight"
              type="monotone"
              dataKey="Lean Mass (kg)"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
