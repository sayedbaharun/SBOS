import { useQuery } from "@tanstack/react-query";
import { format, parseISO, isToday, isTomorrow } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Calendar, RefreshCw, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DUBAI_TZ = "Asia/Dubai";

interface CalendarEvent {
  title: string;
  country: string;
  date: string;
  impact: "High" | "Medium" | "Low" | "Holiday" | string;
  forecast: string;
  previous: string;
  actual: string;
}

interface GroupedDay {
  label: string;
  date: Date;
  isToday: boolean;
  isTomorrow: boolean;
  events: CalendarEvent[];
}

const IMPACT_CONFIG = {
  High: { label: "High", classes: "bg-red-500/15 text-red-600 border-red-300 dark:text-red-400" },
  Medium: { label: "Med", classes: "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400" },
  Low: { label: "Low", classes: "bg-muted text-muted-foreground border-border" },
  Holiday: { label: "Holiday", classes: "bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400" },
} as const;

const CURRENCY_FLAG: Record<string, string> = {
  USD: "🇺🇸",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  CAD: "🇨🇦",
  AUD: "🇦🇺",
  NZD: "🇳🇿",
  CHF: "🇨🇭",
  CNY: "🇨🇳",
};

function impactConfig(impact: string) {
  return IMPACT_CONFIG[impact as keyof typeof IMPACT_CONFIG] ?? IMPACT_CONFIG.Low;
}

function groupByDay(events: CalendarEvent[]): GroupedDay[] {
  const map = new Map<string, GroupedDay>();

  for (const event of events) {
    const utcDate = parseISO(event.date);
    const dubaiDate = toZonedTime(utcDate, DUBAI_TZ);
    const key = format(dubaiDate, "yyyy-MM-dd");

    if (!map.has(key)) {
      const today = isToday(dubaiDate);
      const tomorrow = isTomorrow(dubaiDate);
      let label = format(dubaiDate, "EEEE, MMM d");
      if (today) label = `Today — ${format(dubaiDate, "EEEE, MMM d")}`;
      else if (tomorrow) label = `Tomorrow — ${format(dubaiDate, "EEEE, MMM d")}`;

      map.set(key, { label, date: dubaiDate, isToday: today, isTomorrow: tomorrow, events: [] });
    }

    map.get(key)!.events.push(event);
  }

  return Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
}

export default function EconomicCalendar() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/trading/economic-calendar"],
    queryFn: async () => {
      const res = await fetch("/api/trading/economic-calendar", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch calendar");
      return res.json();
    },
    staleTime: 60 * 60 * 1000, // 1 hour — matches server cache
  });

  const grouped = data ? groupByDay(data) : [];
  const highImpactToday = grouped
    .find((d) => d.isToday)
    ?.events.filter((e) => e.impact === "High").length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Economic Calendar</CardTitle>
            {highImpactToday > 0 && (
              <Badge variant="destructive" className="text-xs px-1.5 py-0">
                {highImpactToday} high today
              </Badge>
            )}
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">This week • Dubai time (UTC+4)</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-muted-foreground py-4 justify-center text-sm">
            <AlertCircle className="h-4 w-4" />
            <span>Could not load calendar — will retry next refresh</span>
          </div>
        )}

        {!isLoading && !isError && grouped.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            No events found for this week.
          </p>
        )}

        {grouped.map((day) => (
          <div key={day.label}>
            <div
              className={cn(
                "text-xs font-semibold mb-2 flex items-center gap-1.5",
                day.isToday ? "text-primary" : "text-muted-foreground"
              )}
            >
              {day.isToday && (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              )}
              {day.label}
            </div>

            <div className="space-y-1">
              {day.events.map((event, idx) => {
                const utcDate = parseISO(event.date);
                const dubaiDate = toZonedTime(utcDate, DUBAI_TZ);
                const timeStr = format(dubaiDate, "HH:mm");
                const cfg = impactConfig(event.impact);
                const flag = CURRENCY_FLAG[event.country] ?? "";
                const hasActual = event.actual && event.actual !== "";

                return (
                  <div
                    key={idx}
                    className={cn(
                      "grid grid-cols-[48px_1fr_auto] gap-2 items-center px-2.5 py-1.5 rounded-md text-xs border",
                      day.isToday && event.impact === "High"
                        ? "bg-red-500/5 border-red-200 dark:border-red-900"
                        : "bg-muted/30 border-transparent"
                    )}
                  >
                    {/* Time */}
                    <span className="font-mono text-muted-foreground tabular-nums">{timeStr}</span>

                    {/* Event */}
                    <div className="min-w-0">
                      <span className="mr-1">{flag}</span>
                      <span className="font-medium text-foreground">{event.country}</span>
                      <span className="text-muted-foreground mx-1">·</span>
                      <span className="truncate">{event.title}</span>
                    </div>

                    {/* Right side: impact + values */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {hasActual ? (
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            event.actual > (event.forecast || event.previous || "")
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          )}
                        >
                          {event.actual}
                        </span>
                      ) : event.forecast ? (
                        <span className="text-muted-foreground tabular-nums">{event.forecast}</span>
                      ) : null}
                      <Badge variant="outline" className={cn("text-[10px] px-1 py-0 border", cfg.classes)}>
                        {cfg.label}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
