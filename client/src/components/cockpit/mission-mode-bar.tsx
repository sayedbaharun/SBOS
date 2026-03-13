import { motion } from "framer-motion";
import { Sun, Brain, TrendingUp, Coffee, Moon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MissionModeBarProps {
  mode: "morning" | "deep_work" | "trading" | "admin" | "shutdown";
  title: string;
  mission: string;
  actionLabel: string;
  onAction: () => void;
}

const modeStyles = {
  morning: { icon: Sun, color: "text-orange-500", bg: "bg-orange-500/10", border: "border-l-orange-500", pill: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  deep_work: { icon: Brain, color: "text-purple-500", bg: "bg-purple-500/10", border: "border-l-purple-500", pill: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  trading: { icon: TrendingUp, color: "text-green-500", bg: "bg-green-500/10", border: "border-l-green-500", pill: "bg-green-500/15 text-green-600 dark:text-green-400" },
  admin: { icon: Coffee, color: "text-blue-500", bg: "bg-blue-500/10", border: "border-l-blue-500", pill: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  shutdown: { icon: Moon, color: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-l-indigo-500", pill: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" },
};

export function MissionModeBar({ mode, title, mission, actionLabel, onAction }: MissionModeBarProps) {
  const style = modeStyles[mode];
  const Icon = style.icon;

  return (
    <motion.div
      key={mode}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={cn("border-l-4", style.border)}>
        <CardContent className="p-4 flex items-center gap-4">
          <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold flex-shrink-0", style.pill)}>
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{title}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">"{mission}"</p>
          </div>
          <Button size="sm" variant="outline" onClick={onAction} className="flex-shrink-0">
            {actionLabel}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
