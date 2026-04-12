/**
 * NL Query Bar — natural language command/query interface for Command Center V4.
 *
 * Appears in the CC header. Accepts plain-English questions or commands,
 * calls POST /api/nl/query, and surfaces the answer in a popover below.
 *
 * If the response action is "create_task", shows a toast confirming creation.
 */
import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface NlQueryResponse {
  answer: string;
  action: { type: string; payload: Record<string, unknown> } | null;
}

export function NlQueryBar() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const mutation = useMutation<NlQueryResponse, Error, string>({
    mutationFn: async (q: string) => {
      const res = await apiRequest("POST", "/api/nl/query", { q });
      return res.json() as Promise<NlQueryResponse>;
    },
    onSuccess: (data) => {
      setAnswer(data.answer);
      setOpen(true);

      // If the action was create_task, fire a toast
      if (data.action?.type === "create_task") {
        const title =
          (data.action.payload?.title as string) ?? "New task";
        toast({
          title: "Task created",
          description: title,
        });
      }
    },
    onError: (err) => {
      setAnswer(`Error: ${err.message}`);
      setOpen(true);
    },
  });

  function handleSubmit() {
    const trimmed = query.trim();
    if (!trimmed || mutation.isPending) return;
    setAnswer(null);
    mutation.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSubmit();
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.closest("[data-nl-query-bar]")?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div
      className="relative w-full max-w-lg"
      data-nl-query-bar
    >
      <Popover open={open && answer !== null} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* Invisible trigger — we control open state programmatically */}
          <span className="sr-only" aria-hidden />
        </PopoverTrigger>

        <div className="flex items-center gap-2">
          {/* Search icon decoration */}
          <div className="relative flex-1">
            <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              {mutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything or give a command..."
              className={cn(
                "pl-8 pr-3 h-8 text-sm bg-background/60 border-border/50",
                "placeholder:text-muted-foreground/60",
                "focus-visible:ring-1 focus-visible:ring-primary/40",
                "transition-all duration-150",
                mutation.isPending && "opacity-70"
              )}
              disabled={mutation.isPending}
              aria-label="Natural language query"
            />
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs border-border/50 shrink-0"
            onClick={handleSubmit}
            disabled={mutation.isPending || !query.trim()}
            aria-label="Submit query"
          >
            {mutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <PopoverContent
          className="w-[min(420px,calc(100vw-2rem))] p-3 text-sm shadow-lg border-border/60"
          align="start"
          sideOffset={6}
          onInteractOutside={() => setOpen(false)}
        >
          {answer !== null && (
            <div className="space-y-2">
              {/* Answer text */}
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground">
                {answer}
              </p>

              {/* Action badge if an action was triggered */}
              {mutation.data?.action && (
                <div className="pt-1 border-t border-border/40">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                    Action:{" "}
                    <span className="text-primary/80">
                      {mutation.data.action.type.replace(/_/g, " ")}
                    </span>
                  </span>
                </div>
              )}

              {/* Dismiss */}
              <div className="flex justify-end pt-0.5">
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    setAnswer(null);
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
