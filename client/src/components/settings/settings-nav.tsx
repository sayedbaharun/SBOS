import { Link } from "wouter";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

const settingsLinks = [
  { href: "/settings", label: "Profile" },
  { href: "/settings/ai", label: "AI" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/categories", label: "Categories" },
  { href: "/settings/external-agents", label: "Agents" },
  { href: "/settings/commands", label: "Commands" },
];

export default function SettingsNav() {
  const [location] = useLocation();

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <nav className="flex items-center gap-1 min-w-max">
        {settingsLinks.map(({ href, label }) => {
          const isActive = href === "/settings"
            ? location === "/settings"
            : location === href || location.startsWith(href + "/");

          return (
            <Link key={href} href={href}>
              <a
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {label}
              </a>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
