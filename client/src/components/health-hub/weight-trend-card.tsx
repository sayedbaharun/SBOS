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
  ReferenceLine,
} from "recharts";

interface WeightPoint {
  date: string;
  weightKg: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-semibold">{payload[0]?.value} kg</p>
    </div>
  );
};

export default function WeightTrendCard() {
  const { data, isLoading, isError, error } = useQuery<WeightPoint[]>({
    queryKey: ["/api/health/weight-trend"],
    retry: 1,
    staleTime: 60 * 60 * 1000, // 1 hour — matches server cache
  });

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2 pt-4 px-4">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data || data.length === 0) {
    const msg = isError
      ? (error as any)?.message?.includes("not found")
        ? "Upload a weight.csv to your Google Drive /health folder to see your trend."
        : "Could not load weight data — check Google Drive connection."
      : "No weight data yet. Upload a weight.csv to your Google Drive /health folder.";

    return (
      <Card className="border-border bg-muted/10">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Weight (Google Drive)</CardTitle>
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
  const delta = latest.weightKg - first.weightKg;
  const deltaText = `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg since first entry`;
  const TrendIcon = delta < -0.3 ? TrendingDown : delta > 0.3 ? TrendingUp : Minus;
  const trendColor = delta < -0.3 ? "text-emerald-400" : delta > 0.3 ? "text-rose-400" : "text-muted-foreground";

  const chartData = data.map(d => ({
    date: d.date,
    weightKg: d.weightKg,
    displayDate: format(parseISO(d.date), "MMM d"),
  }));

  const weights = data.map(d => d.weightKg);
  const minW = Math.min(...weights) - 1;
  const maxW = Math.max(...weights) + 1;
  const avgW = weights.reduce((a, b) => a + b, 0) / weights.length;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Weight</CardTitle>
            <span className="text-xs text-muted-foreground">(from Google Drive)</span>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1 text-xs ${trendColor}`}>
              <TrendIcon className="h-3 w-3" />
              <span>{deltaText}</span>
            </div>
            <span className="text-2xl font-bold">{latest.weightKg} kg</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-4">
        <ResponsiveContainer width="100%" height={100}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[minW, maxW]}
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={avgW} stroke="#6366f1" strokeDasharray="3 3" strokeOpacity={0.4} />
            <Line
              type="monotone"
              dataKey="weightKg"
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ fill: "#6366f1", r: 3 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
