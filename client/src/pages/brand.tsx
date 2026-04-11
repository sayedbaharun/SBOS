import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Megaphone, Target, BookOpen, GraduationCap, Headphones,
  Linkedin, Twitter, Mail, ArrowRight, Zap, Globe, Building2,
  User, TrendingUp
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Book {
  id: string;
  title: string;
  author: string | null;
  status: "to_read" | "reading" | "finished";
}

interface Course {
  id: string;
  title: string;
  instructor: string | null;
  status: "not_started" | "in_progress" | "completed";
  progress: number;
}

interface Podcast {
  id: string;
  title: string;
  host: string | null;
  status: "listening" | "completed" | "dropped";
}

// ─── Brand Identity ───────────────────────────────────────────────────────────

const ARCHETYPE = "The Builder";
const ARCHETYPE_DESC = "Building in public — sharing the journey, the systems, and the results in real time.";

const MOAT = [
  { icon: Zap, label: "AI Builder", desc: "SB-OS, SyntheLIQ, hybrid-memory, agent systems" },
  { icon: User, label: "One-Person Operator", desc: "Multiple ventures solo, AI as leverage" },
  { icon: Globe, label: "Dubai-Based", desc: "Investor visa, DMCC, MENA ecosystem" },
  { icon: TrendingUp, label: "Self-Optimisation", desc: "WHOOP, gym 5x/week, peptides, data-tracked" },
  { icon: Building2, label: "Serial Entrepreneur", desc: "Decade of ventures: 2015–2026" },
];

// ─── Content Framework ────────────────────────────────────────────────────────

const CONTENT_SPLIT = [
  { label: "Authority", pct: 33, desc: "Opinions, frameworks, industry analysis", color: "bg-blue-500" },
  { label: "Technical", pct: 33, desc: "How-tos, build-in-public, breakdowns", color: "bg-violet-500" },
  { label: "Story", pct: 34, desc: "Journey, lessons, failures, BTS", color: "bg-orange-500" },
];

// ─── Platforms ────────────────────────────────────────────────────────────────

const PLATFORMS = [
  { icon: Linkedin, label: "LinkedIn", cadence: "3–5× / week", goal: "Authority", active: true },
  { icon: Twitter, label: "X / Twitter", cadence: "Daily", goal: "Community", active: true },
  { icon: Mail, label: "Newsletter", cadence: "Weekly", goal: "Owned audience", active: false },
];

// ─── Currently Learning Widget ────────────────────────────────────────────────

function CurrentlyLearningWidget() {
  const { data: books = [] } = useQuery<Book[]>({ queryKey: ["/api/books"] });
  const { data: courseList = [] } = useQuery<Course[]>({ queryKey: ["/api/courses"] });
  const { data: podcastList = [] } = useQuery<Podcast[]>({ queryKey: ["/api/podcasts"] });

  const activeBooks = (Array.isArray(books) ? books : []).filter((b) => b.status === "reading").slice(0, 2);
  const activeCourses = (Array.isArray(courseList) ? courseList : []).filter((c) => c.status === "in_progress").slice(0, 2);
  const activePodcasts = (Array.isArray(podcastList) ? podcastList : []).filter((p) => p.status === "listening").slice(0, 2);

  const hasAny = activeBooks.length > 0 || activeCourses.length > 0 || activePodcasts.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-violet-500" />
            Currently Learning
          </CardTitle>
          <Link href="/learning">
            <Button variant="ghost" size="sm" className="text-xs gap-1 h-7">
              View all <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <p className="text-sm text-muted-foreground">Nothing active yet. <Link href="/learning"><span className="underline cursor-pointer">Add items →</span></Link></p>
        ) : (
          <div className="space-y-3">
            {activeBooks.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-blue-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{b.title}</p>
                  {b.author && <p className="text-xs text-muted-foreground truncate">by {b.author}</p>}
                </div>
                <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-xs ml-auto flex-shrink-0">Reading</Badge>
              </div>
            ))}
            {activeCourses.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4 text-violet-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.title}</p>
                  <Progress value={c.progress} className="h-1 mt-1" />
                </div>
                <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{c.progress}%</span>
              </div>
            ))}
            {activePodcasts.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <Headphones className="h-4 w-4 text-purple-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.title}</p>
                  {p.host && <p className="text-xs text-muted-foreground truncate">by {p.host}</p>}
                </div>
                <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 text-xs ml-auto flex-shrink-0">Listening</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BrandPage() {
  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Megaphone className="h-8 w-8" />
          Personal Brand HQ
        </h1>
        <p className="text-muted-foreground mt-1">Strategy, content framework, and platforms — all in one place.</p>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Brand Identity */}
        <Card className="lg:row-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-orange-500" />
              Brand Identity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="p-4 rounded-lg bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900 border border-orange-200 dark:border-orange-800">
              <p className="text-xs text-orange-600 dark:text-orange-400 font-medium uppercase tracking-wide mb-1">Archetype</p>
              <p className="text-2xl font-bold text-orange-900 dark:text-orange-100">{ARCHETYPE}</p>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">{ARCHETYPE_DESC}</p>
            </div>

            <div>
              <p className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">5-Element Moat</p>
              <div className="space-y-3">
                {MOAT.map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="flex items-start gap-3">
                    <div className="p-1.5 rounded-md bg-muted flex-shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground italic border-t pt-4">
              Every piece of content touches at least 2 of these 5 elements.
            </p>
          </CardContent>
        </Card>

        {/* Content Framework */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="h-5 w-5 text-blue-500" />
              Content Framework (33/33/33)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {CONTENT_SPLIT.map(({ label, pct, desc, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-sm text-muted-foreground">{pct}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </div>
            ))}
            <div className="mt-3 p-3 bg-muted rounded-lg text-xs text-muted-foreground">
              <strong className="text-foreground">Funnel split:</strong> 50% top (discovery) → 30% middle (trust) → 20% bottom (conversion)
            </div>
          </CardContent>
        </Card>

        {/* Platforms */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-5 w-5 text-green-500" />
              Platform Stack
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {PLATFORMS.map(({ icon: Icon, label, cadence, goal, active }) => (
                <div key={label} className="flex items-center gap-3 p-2.5 rounded-lg border">
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{cadence} · {goal}</p>
                  </div>
                  <Badge variant={active ? "default" : "outline"} className="text-xs">
                    {active ? "Active" : "Month 2+"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Currently Learning (full width) */}
      <CurrentlyLearningWidget />
    </div>
  );
}
