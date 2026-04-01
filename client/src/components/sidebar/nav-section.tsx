import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { LucideIcon, ChevronDown, ChevronRight } from "lucide-react";
import NavItem from "./nav-item";
import { BadgeVariant } from "./nav-badge";

export interface NavItemConfig {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: {
    content: React.ReactNode;
    variant?: BadgeVariant;
  };
}

export interface NavSectionProps {
  label: string;
  items: NavItemConfig[];
  isCollapsed?: boolean;
  onItemClick?: () => void;
  defaultExpanded?: boolean;
}

/**
 * NavSection Component
 *
 * A grouped section of navigation items with a collapsible label.
 *
 * @example
 * ```tsx
 * <NavSection
 *   label="Main"
 *   items={[
 *     { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
 *     { href: "/tasks", icon: CheckSquare, label: "Tasks", badge: { content: 5, variant: "alert" } }
 *   ]}
 *   isCollapsed={false}
 *   defaultExpanded={true}
 * />
 * ```
 *
 * Props:
 * - label: Section heading text (displayed in uppercase, small, muted)
 * - items: Array of navigation item configurations
 * - isCollapsed: Whether the sidebar is collapsed (icon-only mode)
 * - onItemClick: Optional callback when any item is clicked (useful for mobile menu)
 * - defaultExpanded: Whether section is expanded by default (defaults to true)
 *
 * Customization:
 * To modify the navigation structure, simply update the items array:
 * - Add new items: Add objects to the array
 * - Remove items: Filter out unwanted items
 * - Reorder: Change array order
 * - Update badges: Modify the badge property dynamically
 */
export default function NavSection({
  label,
  items,
  isCollapsed = false,
  onItemClick,
  defaultExpanded = true,
}: NavSectionProps) {
  const [location] = useLocation();
  const storageKey = `nav-section-${label.toLowerCase().replace(/\s+/g, '-')}-expanded`;

  // Initialize from localStorage or default
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        return stored === 'true';
      }
    }
    return defaultExpanded;
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(storageKey, String(isExpanded));
  }, [isExpanded, storageKey]);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Check if any item in this section is active
  const hasActiveItem = items.some(
    (item) => location === item.href || location.startsWith(item.href + "/")
  );

  return (
    <div className="mt-6">
      {!isCollapsed && (
        <button
          onClick={toggleExpanded}
          className={cn(
            "w-full flex items-center justify-between px-2 py-1 text-[11px] font-medium uppercase tracking-widest rounded-md transition-colors",
            hasActiveItem ? "text-muted-foreground" : "text-muted-foreground/60"
          )}
          aria-expanded={isExpanded}
          aria-controls={`nav-section-${label}`}
        >
          <span>{label}</span>
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      )}
      {(isExpanded || isCollapsed) && (
        <nav
          id={`nav-section-${label}`}
          className={cn("space-y-1", !isCollapsed && "mt-1")}
          role="navigation"
          aria-label={label}
        >
          {items.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              isActive={location === item.href || location.startsWith(item.href + "/")}
              isCollapsed={isCollapsed}
              onClick={onItemClick}
            />
          ))}
        </nav>
      )}
    </div>
  );
}
