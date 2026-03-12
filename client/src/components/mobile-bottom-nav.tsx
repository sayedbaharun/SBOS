import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, CheckSquare, ClipboardCheck, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

const tabs = [
  { icon: LayoutDashboard, label: "Home", route: "/dashboard", hasBadge: false },
  { icon: CheckSquare, label: "Tasks", route: "/tasks", hasBadge: false },
  { icon: ClipboardCheck, label: "Review", route: "/review-queue", hasBadge: true },
  { icon: Bot, label: "Agents", route: "/agents", hasBadge: false },
] as const;

export default function MobileBottomNav() {
  const [location, navigate] = useLocation();

  const { data: stats } = useQuery<{ pending: number }>({
    queryKey: ["review-stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/review/stats");
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: 30000,
  });

  const pendingCount = stats?.pending || 0;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-background/95 backdrop-blur-sm border-t safe-area-bottom">
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const isActive = location === tab.route ||
            (tab.route === "/dashboard" && location === "/");
          const Icon = tab.icon;

          return (
            <button
              key={tab.route}
              onClick={() => navigate(tab.route)}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative",
                "transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {tab.hasBadge && pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1.5 h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {pendingCount > 9 ? "9+" : pendingCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
