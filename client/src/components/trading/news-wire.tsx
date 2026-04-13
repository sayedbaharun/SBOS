import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { RefreshCw, ExternalLink, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

interface NewsData {
  items: NewsItem[];
  fetchedAt: string | null;
  error?: string;
}

export default function NewsWire() {
  const { data, isLoading, refetch, isFetching } = useQuery<NewsData>({
    queryKey: ["/api/trading/news"],
    queryFn: async () => {
      const res = await fetch("/api/trading/news", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 10 * 60_000,
    refetchInterval: 12 * 60_000,
  });

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Radio className="h-3 w-3" />
          ForexLive Wire
        </div>
        <button onClick={() => refetch()} disabled={isFetching} className="text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-3/4 bg-muted rounded" />
              <div className="h-2.5 w-1/3 bg-muted rounded" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && data?.error && (
        <p className="text-xs text-muted-foreground">News feed unavailable — check back soon.</p>
      )}

      {!isLoading && !data?.error && (data?.items ?? []).length === 0 && (
        <p className="text-xs text-muted-foreground">No recent headlines.</p>
      )}

      <div className="space-y-0">
        {(data?.items ?? []).map((item, i) => {
          let timeStr = "";
          try {
            timeStr = format(parseISO(item.pubDate), "HH:mm");
          } catch {
            timeStr = "";
          }

          return (
            <div key={i} className="group flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
              <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 mt-0.5 w-9 tabular-nums">{timeStr}</span>
              <div className="flex-1 min-w-0">
                {item.link ? (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-foreground hover:text-primary transition-colors leading-snug flex items-start gap-1 group"
                  >
                    <span className="flex-1">{item.title}</span>
                    <ExternalLink className="h-2.5 w-2.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </a>
                ) : (
                  <p className="text-xs font-medium text-foreground leading-snug">{item.title}</p>
                )}
                {item.description && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{item.description}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
