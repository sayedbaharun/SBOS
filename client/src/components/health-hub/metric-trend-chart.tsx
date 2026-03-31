import { format, parseISO } from "date-fns";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type MetricStatus, STATUS_CLASSES } from "./health-thresholds";

export interface TrendDataPoint {
  date: string;
  value: number | null;
}

interface MetricTrendChartProps {
  data: TrendDataPoint[];
  label: string;
  unit: string;
  chartType?: "line" | "bar" | "dot";
  /** For dot/bar: value=1 means "done", 0 means "not done" */
  binaryMode?: boolean;
  thresholdGreen?: number;
  thresholdAmber?: number;
  /** For inverted metrics (lower = better, e.g. RHR): flip the color logic */
  invertedThresholds?: boolean;
  domain?: [number | "auto", number | "auto"];
  getStatus?: (val: number | null) => MetricStatus;
}

const CHART_COLOR = "#6366f1"; // indigo-500

function getLineColor(status: MetricStatus): string {
  return STATUS_CLASSES[status].dot.replace("bg-", "");
}

const CustomTooltip = ({ active, payload, label, unit }: any) => {
  if (!active || !payload?.length) return null;
  const val = payload[0]?.value;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-semibold">{val !== null && val !== undefined ? `${val} ${unit}` : "—"}</p>
    </div>
  );
};

export default function MetricTrendChart({
  data,
  label,
  unit,
  chartType = "line",
  binaryMode = false,
  thresholdGreen,
  thresholdAmber,
  domain,
  getStatus,
}: MetricTrendChartProps) {
  const hasData = data.some(d => d.value !== null);

  // Format date labels
  const chartData = data.map(d => ({
    ...d,
    displayDate: d.date ? format(parseISO(d.date), "MMM d") : "",
    value: d.value,
  }));

  const latestValue = [...data].reverse().find(d => d.value !== null)?.value ?? null;
  const currentStatus = getStatus ? getStatus(latestValue) : "neutral";
  const sc = STATUS_CLASSES[currentStatus];

  return (
    <Card className={cn("border", sc.border, "bg-card")}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          <span className={cn("text-lg font-bold", currentStatus !== "neutral" ? "text-foreground" : "text-muted-foreground")}>
            {latestValue !== null
              ? binaryMode
                ? latestValue === 1 ? "Done" : "Rest"
                : `${typeof latestValue === "number" && latestValue >= 1000 ? (latestValue / 1000).toFixed(1) + "k" : latestValue} ${unit}`
              : "—"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-4">
        {!hasData ? (
          <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">No data</div>
        ) : chartType === "bar" || binaryMode ? (
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -32, bottom: 0 }}>
              <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={domain ?? ["auto", "auto"]} tick={false} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip unit={unit} />} />
              {thresholdGreen && <ReferenceLine y={thresholdGreen} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.4} />}
              {thresholdAmber && <ReferenceLine y={thresholdAmber} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.4} />}
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={
                      binaryMode
                        ? entry.value === 1 ? "#10b981" : "#3f3f46"
                        : getStatus
                          ? STATUS_CLASSES[getStatus(entry.value)].dot.replace("bg-", "#")
                          : CHART_COLOR
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: -32, bottom: 0 }}>
              <XAxis dataKey="displayDate" tick={{ fontSize: 10, fill: "#71717a" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis domain={domain ?? ["auto", "auto"]} tick={false} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip unit={unit} />} />
              {thresholdGreen && <ReferenceLine y={thresholdGreen} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.4} />}
              {thresholdAmber && <ReferenceLine y={thresholdAmber} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.4} />}
              <Line
                type="monotone"
                dataKey="value"
                stroke={CHART_COLOR}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
