// Command Center V2 - HUD Interface
// Build version: 2025-12-02-v5
import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { HealthBattery, ContextCard, MissionStatement, DailyScorecard, type ScorecardMetric } from "@/components/cockpit/cockpit-components";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Circle, Clock, Inbox, ChevronRight, Flame, AlertTriangle, CheckCircle2, Target, Calendar, CalendarDays, Video, MapPin, Moon, Sun, Utensils } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import QuickLogModal from "@/components/health-hub/quick-log-modal";
import { useWebSocket } from "@/hooks/use-websocket";

function NutritionToggleCard() {
    const today = new Date().toISOString().split('T')[0];
    const { data: dayData } = useQuery({
        queryKey: ["dashboard-day"],
    });

    const nutritionMutation = useMutation({
        mutationFn: async (updates: { proteinMet?: boolean; caloriesOver2100?: boolean }) => {
            try {
                const res = await apiRequest("PATCH", `/api/days/${today}`, {
                    id: `day_${today}`,
                    date: today,
                    ...updates,
                });
                return await res.json();
            } catch {
                const res = await apiRequest("POST", "/api/days", {
                    id: `day_${today}`,
                    date: today,
                    ...updates,
                });
                return await res.json();
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["dashboard-day"] });
            queryClient.invalidateQueries({ queryKey: ["dashboard-scorecard"] });
        },
    });

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Utensils className="h-4 w-4" />
                    Daily Nutrition
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                    <Checkbox
                        id="protein-met"
                        checked={!!(dayData as any)?.proteinMet}
                        onCheckedChange={(checked) => nutritionMutation.mutate({ proteinMet: !!checked })}
                    />
                    <Label htmlFor="protein-met" className="text-sm cursor-pointer">
                        Protein target met (200g+)
                    </Label>
                </div>
                <div className="flex items-center gap-3">
                    <Checkbox
                        id="calories-over-2100"
                        checked={!!(dayData as any)?.caloriesOver2100}
                        onCheckedChange={(checked) => nutritionMutation.mutate({ caloriesOver2100: !!checked })}
                    />
                    <Label htmlFor="calories-over-2100" className="text-sm cursor-pointer">
                        Calories over 2100
                    </Label>
                </div>
            </CardContent>
        </Card>
    );
}

export default function CommandCenterV2() {
    const [, navigate] = useLocation();
    const [time, setTime] = useState(new Date());
    const [showHealthLog, setShowHealthLog] = useState(false);

    // Real-time updates via WebSocket
    const { connected: wsConnected } = useWebSocket();

    // Fetch readiness data
    const { data: readiness, isLoading: isLoadingReadiness, error: readinessError } = useQuery({
        queryKey: ["dashboard-readiness"],
        queryFn: async () => {
            const res = await fetch("/api/dashboard/readiness");
            if (!res.ok) throw new Error("Failed to fetch readiness");
            return res.json();
        },
        refetchInterval: 60000
    });

    // Fetch urgent tasks (On Fire indicator)
    const { data: urgent = { onFire: false, totalUrgent: 0, tasks: [] }, isLoading: isLoadingUrgent } = useQuery({
        queryKey: ["dashboard-urgent"],
        queryFn: async () => {
            const res = await fetch("/api/dashboard/urgent");
            if (!res.ok) throw new Error("Failed to fetch urgent");
            return res.json();
        }
        // Uses default staleTime (30s) - removed staleTime: 0 which caused constant refetches
    });

    // Fetch Top 3 tasks
    const { data: top3Data = { tasks: [] }, isLoading: isLoadingTop3 } = useQuery({
        queryKey: ["dashboard-top3"],
        queryFn: async () => {
            const res = await fetch("/api/dashboard/top3");
            if (!res.ok) throw new Error("Failed to fetch top3");
            return res.json();
        }
    });

    // Fetch ventures data
    const { data: ventures = [], isLoading: isLoadingVentures, error: venturesError } = useQuery({
        queryKey: ["dashboard-ventures"],
        queryFn: async () => {
            const res = await fetch("/api/dashboard/ventures");
            if (!res.ok) throw new Error("Failed to fetch ventures");
            return res.json();
        }
    });

    // Fetch inbox data
    const { data: inbox = { count: 0, items: [] }, isLoading: isLoadingInbox } = useQuery({
        queryKey: ["dashboard-inbox"],
        queryFn: async () => {
            const res = await fetch("/api/dashboard/inbox");
            if (!res.ok) throw new Error("Failed to fetch inbox");
            return res.json();
        }
    });

    // Fetch today's day summary
    const { data: dayData, isLoading: isLoadingDay } = useQuery({
        queryKey: ["dashboard-day"],
        queryFn: async () => {
            const res = await fetch("/api/dashboard/day");
            if (!res.ok) throw new Error("Failed to fetch day");
            return res.json();
        }
    });

    // Fetch next meeting
    const { data: nextMeeting = { configured: false, meeting: null }, isLoading: isLoadingMeeting } = useQuery({
        queryKey: ["dashboard-next-meeting"],
        queryFn: async () => {
            const res = await fetch("/api/dashboard/next-meeting");
            if (!res.ok) throw new Error("Failed to fetch next meeting");
            return res.json();
        },
        refetchInterval: 60000 // Refresh every minute
    });

    // Fetch current week data
    const { data: weekData, isLoading: isLoadingWeek } = useQuery({
        queryKey: ["weeks-current"],
        queryFn: async () => {
            const res = await fetch("/api/weeks/current");
            if (!res.ok) throw new Error("Failed to fetch week");
            return res.json();
        }
    });

    // Fetch daily scorecard
    const { data: scorecardData, isLoading: isLoadingScorecard } = useQuery({
        queryKey: ["dashboard-scorecard"],
        queryFn: async () => {
            const res = await fetch("/api/dashboard/scorecard");
            if (!res.ok) throw new Error("Failed to fetch scorecard");
            return res.json();
        },
        refetchInterval: 60000 // Refresh every minute
    });

    // Update time every minute
    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    // Determine Mode based on time
    const hour = time.getHours();
    let mode: "morning" | "deep_work" | "trading" | "admin" | "shutdown" = "morning";

    if (hour >= 5 && hour < 9) mode = "morning";
    else if (hour >= 9 && hour < 12) mode = "deep_work";
    else if (hour >= 12 && hour < 14) mode = "admin";
    else if (hour >= 14 && hour < 17) mode = "trading";
    else if (hour >= 17 && hour < 20) mode = "admin";
    else mode = "shutdown";

    // Mode Configuration with navigation targets
    const modeConfig = {
        morning: {
            title: "Ignition Sequence",
            description: "Hydrate. Move. Plan. Do not check email.",
            action: "Start Ritual",
            navigateTo: "/morning"
        },
        deep_work: {
            title: "Deep Work Protocol",
            description: "90 minutes. One task. No distractions.",
            action: "Start Focus Timer",
            navigateTo: "/deep-work"
        },
        trading: {
            title: "Alpha Desk",
            description: "Market is open. Check setups. Manage risk.",
            action: "Open Trading",
            navigateTo: "/trading"
        },
        admin: {
            title: "Admin & Logistics",
            description: "Process inbox. Reply to emails. Clear the clutter.",
            action: "Open Inbox",
            navigateTo: "/capture"
        },
        shutdown: {
            title: "System Shutdown",
            description: "Review the day. Plan tomorrow. Disconnect.",
            action: "Start Review",
            navigateTo: "/evening"
        }
    };

    const currentConfig = modeConfig[mode];

    const handleAction = () => {
        navigate(currentConfig.navigateTo);
    };

    // Derive mission from day data
    const mission = dayData?.oneThingToShip || dayData?.title || "Define today's mission";

    // Check if health needs to be logged (for morning mode prompt)
    const needsHealthLog = readiness?.status === "no_data";

    // Format time until meeting
    const formatTimeUntil = (minutes: number) => {
        if (minutes < 60) return `in ${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (mins === 0) return `in ${hours}h`;
        return `in ${hours}h ${mins}m`;
    };

    return (
        <div className="min-h-screen bg-background p-4 md:p-8 flex flex-col gap-6 max-w-7xl mx-auto">
            {/* ON FIRE ALERT */}
            {!isLoadingUrgent && urgent.onFire && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-center gap-4">
                    <div className="p-2 bg-red-500/20 rounded-full">
                        <Flame className="h-6 w-6 text-red-500 animate-pulse" />
                    </div>
                    <div className="flex-1">
                        <div className="font-semibold text-red-600 dark:text-red-400">
                            {urgent.overdueP0Count > 0
                                ? `${urgent.overdueP0Count} overdue P0 task${urgent.overdueP0Count > 1 ? 's' : ''}`
                                : `${urgent.dueTodayCount} P0 task${urgent.dueTodayCount > 1 ? 's' : ''} due today`
                            }
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {urgent.tasks[0]?.title}
                        </div>
                    </div>
                    <button
                        onClick={() => navigate("/tasks")}
                        className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
                    >
                        View Tasks
                    </button>
                </div>
            )}

            {/* MORNING MODE: Health Log Prompt */}
            {mode === "morning" && needsHealthLog && !isLoadingReadiness && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4 flex items-center gap-4">
                    <div className="p-2 bg-orange-500/20 rounded-full">
                        <Sun className="h-6 w-6 text-orange-500" />
                    </div>
                    <div className="flex-1">
                        <div className="font-semibold text-orange-600 dark:text-orange-400">
                            Good morning! Log your health to start the day
                        </div>
                        <div className="text-sm text-muted-foreground">
                            Track sleep, energy, and mood for better planning
                        </div>
                    </div>
                    <Button
                        onClick={() => setShowHealthLog(true)}
                        className="bg-orange-500 hover:bg-orange-600 text-white"
                    >
                        Log Health
                    </Button>
                </div>
            )}

            {/* HEADER: HUD */}
            <header className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Command Center <span className="text-xs text-muted-foreground font-normal">v2.4</span></h1>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="mx-2">•</span>
                        <span className="uppercase font-semibold text-xs tracking-wider">{mode.replace("_", " ")} MODE</span>
                        {wsConnected && (
                            <>
                                <span className="mx-2">•</span>
                                <span className="text-green-500 text-xs flex items-center gap-1">
                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                                    LIVE
                                </span>
                            </>
                        )}
                        {!isLoadingUrgent && urgent.totalUrgent > 0 && !urgent.onFire && (
                            <>
                                <span className="mx-2">•</span>
                                <span className="text-yellow-600 dark:text-yellow-400 text-xs font-medium flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3" />
                                    {urgent.totalUrgent} urgent
                                </span>
                            </>
                        )}
                    </div>
                </div>

                <div className="w-full md:w-auto">
                    {isLoadingReadiness ? (
                        <div className="flex items-center gap-4">
                            <Skeleton className="h-8 w-8 rounded" />
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-6 w-12" />
                            </div>
                        </div>
                    ) : readinessError ? (
                        <div className="text-sm text-red-500">Offline</div>
                    ) : (
                        <HealthBattery
                            percentage={readiness?.percentage || 0}
                            sleepHours={readiness?.sleep || 0}
                            mood={readiness?.mood || "unknown"}
                        />
                    )}
                </div>
            </header>

            <Separator />

            {/* NEXT MEETING BANNER */}
            {!isLoadingMeeting && nextMeeting.meeting && (
                <Card className="border-purple-500/20 bg-purple-500/5">
                    <CardContent className="p-4 flex items-center gap-4">
                        <div className="p-2 bg-purple-500/20 rounded-full">
                            <Calendar className="h-5 w-5 text-purple-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{nextMeeting.meeting.title}</div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                                <span className={`font-semibold ${nextMeeting.meeting.minutesUntil <= 15 ? 'text-orange-500' : 'text-purple-500'}`}>
                                    {formatTimeUntil(nextMeeting.meeting.minutesUntil)}
                                </span>
                                {nextMeeting.meeting.location && (
                                    <>
                                        <span>•</span>
                                        <MapPin className="h-3 w-3" />
                                        <span className="truncate">{nextMeeting.meeting.location}</span>
                                    </>
                                )}
                            </div>
                        </div>
                        {nextMeeting.meeting.meetLink && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="flex-shrink-0"
                                onClick={() => window.open(nextMeeting.meeting.meetLink, '_blank')}
                            >
                                <Video className="h-4 w-4 mr-2" />
                                Join
                            </Button>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* MAIN CONTENT: THE COCKPIT */}
            <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">

                {/* LEFT: VENTURE STATUS + INBOX */}
                <div className="lg:col-span-3 space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Ventures</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {isLoadingVentures ? (
                                <div className="space-y-3">
                                    {[1, 2, 3].map(i => (
                                        <div key={i} className="flex items-center justify-between">
                                            <Skeleton className="h-4 w-24" />
                                            <Skeleton className="h-5 w-16" />
                                        </div>
                                    ))}
                                </div>
                            ) : venturesError ? (
                                <div className="text-sm text-red-500">Error: {(venturesError as Error).message}</div>
                            ) : ventures.length === 0 ? (
                                <div className="text-sm text-muted-foreground">No active ventures</div>
                            ) : (
                                ventures.map((v: any) => (
                                    <div
                                        key={v.id}
                                        onClick={() => navigate(`/ventures/${v.slug || v.id}`)}
                                        className="flex items-center justify-between p-2 -mx-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className={`h-2 w-2 rounded-full flex-shrink-0 ${v.urgencyColor}`} />
                                            <span className="font-medium truncate">{v.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {v.urgency === 'critical' ? (
                                                <span className="text-xs bg-red-500/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                                                    <Flame className="h-3 w-3" />
                                                    {v.urgencyLabel}
                                                </span>
                                            ) : v.urgency === 'warning' ? (
                                                <span className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-2 py-0.5 rounded font-medium flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    {v.urgencyLabel}
                                                </span>
                                            ) : v.taskCount > 0 ? (
                                                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                                                    {v.taskCount}
                                                </span>
                                            ) : (
                                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            )}
                                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>

                    <Card
                        onClick={() => navigate("/capture")}
                        className="cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Inbox className="h-4 w-4" />
                                Inbox
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {isLoadingInbox ? (
                                <Skeleton className="h-8 w-12" />
                            ) : (
                                <>
                                    <div className="text-3xl font-bold">{inbox.count}</div>
                                    <p className="text-xs text-muted-foreground mb-3">Items to process</p>
                                    {inbox.items && inbox.items.length > 0 && (
                                        <div className="space-y-1 border-t pt-2">
                                            {inbox.items.map((item: any) => (
                                                <div key={item.id} className="text-xs text-muted-foreground truncate">
                                                    • {item.title}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* Week Summary Card */}
                    <Card
                        onClick={() => navigate("/weekly")}
                        className="cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <CalendarDays className="h-4 w-4" />
                                This Week
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {isLoadingWeek ? (
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-20" />
                                    <Skeleton className="h-3 w-full" />
                                    <Skeleton className="h-3 w-full" />
                                </div>
                            ) : weekData ? (
                                <>
                                    <div className="text-sm font-medium mb-2">
                                        Week {weekData.weekNumber}
                                        {weekData.theme && (
                                            <span className="text-muted-foreground font-normal"> • {weekData.theme}</span>
                                        )}
                                    </div>
                                    {weekData.weeklyBig3 && weekData.weeklyBig3.length > 0 ? (
                                        <div className="space-y-1.5">
                                            {weekData.weeklyBig3.map((goal: { text: string; completed: boolean }, i: number) => (
                                                <div key={i} className="flex items-start gap-2 text-xs">
                                                    <div className={`h-4 w-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                                                        goal.completed
                                                            ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                                                            : 'bg-muted text-muted-foreground'
                                                    }`}>
                                                        {goal.completed ? (
                                                            <CheckCircle2 className="h-3 w-3" />
                                                        ) : (
                                                            <Circle className="h-2 w-2" />
                                                        )}
                                                    </div>
                                                    <span className={goal.completed ? 'line-through text-muted-foreground' : ''}>
                                                        {goal.text || `Goal ${i + 1}`}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">
                                            No weekly goals set
                                        </p>
                                    )}
                                    <div className="mt-3 pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                                        <span>Plan your week</span>
                                        <ChevronRight className="h-3 w-3" />
                                    </div>
                                </>
                            ) : (
                                <div className="text-sm text-muted-foreground">
                                    <p className="mb-2">Week not planned yet</p>
                                    <div className="flex items-center justify-between text-xs">
                                        <span>Start planning</span>
                                        <ChevronRight className="h-3 w-3" />
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Daily Scorecard */}
                    {isLoadingScorecard ? (
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                                    Daily Scorecard
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {[1, 2, 3, 4].map(i => (
                                        <Skeleton key={i} className="h-6 w-full" />
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    ) : scorecardData?.metrics && (
                        <DailyScorecard
                            metrics={scorecardData.metrics}
                            morningComplete={scorecardData.morningComplete}
                            eveningComplete={scorecardData.eveningComplete}
                        />
                    )}

                    {/* Daily Nutrition Quick Toggle */}
                    <NutritionToggleCard />
                </div>

                {/* CENTER: ACTIVE CONTEXT */}
                <div className="lg:col-span-6 flex flex-col gap-6">
                    <div className="flex-1 min-h-[400px]">
                        <ContextCard
                            mode={mode}
                            title={currentConfig.title}
                            description={currentConfig.description}
                            actionLabel={currentConfig.action}
                            onAction={handleAction}
                        />
                    </div>
                    {isLoadingDay ? (
                        <div className="text-center py-6">
                            <Skeleton className="h-4 w-24 mx-auto mb-2" />
                            <Skeleton className="h-6 w-48 mx-auto" />
                        </div>
                    ) : (
                        <MissionStatement mission={mission} />
                    )}
                </div>

                {/* RIGHT: TOP 3 TASKS */}
                <div className="lg:col-span-3 space-y-4">
                    <Card className="h-full">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Target className="h-4 w-4" />
                                Today's Top 3
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {isLoadingTop3 ? (
                                <div className="space-y-3">
                                    {[1, 2, 3].map(i => (
                                        <div key={i} className="flex items-start gap-3 p-2">
                                            <Skeleton className="h-6 w-6 rounded-full" />
                                            <div className="flex-1 space-y-1">
                                                <Skeleton className="h-4 w-full" />
                                                <Skeleton className="h-3 w-20" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : top3Data.tasks.length === 0 ? (
                                <div className="text-sm text-muted-foreground py-8 text-center">
                                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                                    <p>All clear!</p>
                                    <p className="text-xs mt-1">No high-priority tasks</p>
                                </div>
                            ) : (
                                top3Data.tasks.map((t: any, index: number) => (
                                    <div
                                        key={t.id}
                                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer"
                                    >
                                        <div className={`
                                            h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                                            ${t.isOverdue
                                                ? 'bg-red-500 text-white'
                                                : t.isDueToday
                                                    ? 'bg-yellow-500 text-white'
                                                    : t.priority === 'P0'
                                                        ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                                                        : t.priority === 'P1'
                                                            ? 'bg-orange-500/20 text-orange-600 dark:text-orange-400'
                                                            : 'bg-muted text-muted-foreground'
                                            }
                                        `}>
                                            {index + 1}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium text-sm leading-tight">{t.title}</div>
                                            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                                                <span className={`
                                                    ${t.priority === 'P0' ? 'text-red-500' : ''}
                                                    ${t.priority === 'P1' ? 'text-orange-500' : ''}
                                                `}>
                                                    {t.priority}
                                                </span>
                                                {t.isOverdue && (
                                                    <span className="text-red-500 font-medium">OVERDUE</span>
                                                )}
                                                {t.isDueToday && !t.isOverdue && (
                                                    <span className="text-yellow-600 dark:text-yellow-400 font-medium">Due today</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </CardContent>
                    </Card>
                </div>

            </main>

            {/* Quick Health Log Modal */}
            <QuickLogModal
                open={showHealthLog}
                onOpenChange={setShowHealthLog}
            />
        </div>
    );
}
