/**
 * Agent Identity System
 *
 * Shared constants and helpers for agent visual identity.
 * Each agent gets a unique icon + accent color instead of the generic Bot icon.
 */
import {
  Crown,
  Megaphone,
  Code2,
  Layers,
  TrendingUp,
  Search,
  Share2,
  PenTool,
  Microscope,
  Hammer,
  Building2,
  Cpu,
  Bot,
  type LucideIcon,
} from "lucide-react";

// ── Per-slug identity ────────────────────────────────

interface AgentVisual {
  icon: LucideIcon;
  color: string;
  bg: string;
}

const AGENT_IDENTITY: Record<string, AgentVisual> = {
  "chief-of-staff":       { icon: Crown,       color: "text-amber-500",   bg: "bg-amber-500/10" },
  "cmo":                  { icon: Megaphone,    color: "text-pink-500",    bg: "bg-pink-500/10" },
  "cto":                  { icon: Code2,        color: "text-cyan-500",    bg: "bg-cyan-500/10" },
  "head-of-products":     { icon: Layers,       color: "text-indigo-500",  bg: "bg-indigo-500/10" },
  "growth-specialist":    { icon: TrendingUp,   color: "text-emerald-500", bg: "bg-emerald-500/10" },
  "seo-specialist":       { icon: Search,       color: "text-orange-500",  bg: "bg-orange-500/10" },
  "social-media-manager": { icon: Share2,       color: "text-rose-500",    bg: "bg-rose-500/10" },
  "content-strategist":   { icon: PenTool,      color: "text-violet-500",  bg: "bg-violet-500/10" },
  "research-analyst":     { icon: Microscope,   color: "text-teal-500",    bg: "bg-teal-500/10" },
  "mvp-builder":          { icon: Hammer,       color: "text-amber-600",   bg: "bg-amber-600/10" },
  "venture-architect":    { icon: Building2,    color: "text-blue-500",    bg: "bg-blue-500/10" },
  "agent-engineer":       { icon: Cpu,          color: "text-lime-500",    bg: "bg-lime-500/10" },
};

const FALLBACK_IDENTITY: AgentVisual = {
  icon: Bot,
  color: "text-muted-foreground",
  bg: "bg-muted/80",
};

export function getAgentIdentity(slug: string): AgentVisual {
  return AGENT_IDENTITY[slug] || FALLBACK_IDENTITY;
}

// ── Shared role/tier constants ───────────────────────

export const ROLE_DOT: Record<string, string> = {
  executive: "bg-purple-500",
  manager: "bg-blue-500",
  specialist: "bg-emerald-500",
  worker: "bg-amber-500",
};

export const ROLE_TEXT: Record<string, string> = {
  executive: "text-purple-600 dark:text-purple-400",
  manager: "text-blue-600 dark:text-blue-400",
  specialist: "text-emerald-600 dark:text-emerald-400",
  worker: "text-amber-600 dark:text-amber-400",
};

export const TIER_LABELS: Record<string, string> = {
  top: "Opus",
  mid: "Sonnet",
  fast: "Haiku",
  auto: "Auto",
};

export const TIER_COLORS: Record<string, string> = {
  top: "text-purple-500",
  mid: "text-blue-500",
  fast: "text-emerald-500",
  auto: "text-muted-foreground",
};
