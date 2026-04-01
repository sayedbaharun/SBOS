import { Link } from "wouter";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import NavBadge, { BadgeVariant } from "./nav-badge";

export interface NavItemProps {
  href: string;
  icon: LucideIcon;
  label: string;
  badge?: {
    content: React.ReactNode;
    variant?: BadgeVariant;
  };
  isActive?: boolean;
  isCollapsed?: boolean;
  onClick?: () => void;
}

/**
 * NavItem Component
 *
 * A navigation link with icon, label, optional badge, and active/hover states.
 *
 * @example
 * ```tsx
 * <NavItem
 *   href="/dashboard"
 *   icon={LayoutDashboard}
 *   label="Dashboard"
 *   badge={{ content: 5, variant: "alert" }}
 *   isActive={true}
 *   isCollapsed={false}
 * />
 * ```
 *
 * Props:
 * - href: Navigation destination URL
 * - icon: Lucide icon component
 * - label: Text label for the nav item
 * - badge: Optional badge with content and variant
 * - isActive: Whether this nav item represents the current route
 * - isCollapsed: Whether the sidebar is collapsed (shows tooltip on hover)
 * - onClick: Optional click handler (e.g., for closing mobile menu)
 *
 * Accessibility:
 * - Full keyboard navigation support
 * - ARIA labels for screen readers
 * - Tooltips when collapsed
 */
export default function NavItem({
  href,
  icon: Icon,
  label,
  badge,
  isActive = false,
  isCollapsed = false,
  onClick,
}: NavItemProps) {
  const content = (
    <Link href={href}>
      <a
        onClick={onClick}
        className={cn(
          "group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150",
          "hover:bg-sidebar-accent active:scale-95",
          isActive && "bg-primary/10 text-primary font-semibold",
          !isActive && "text-sidebar-foreground hover:text-sidebar-foreground",
          isCollapsed && "justify-center px-2"
        )}
        aria-label={label}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon
          className={cn(
            "h-[18px] w-[18px] flex-shrink-0 transition-colors",
            isActive ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground"
          )}
        />
        {!isCollapsed && (
          <>
            <span className="flex-1 truncate">{label}</span>
            {badge && (
              <NavBadge variant={badge.variant}>
                {badge.content}
              </NavBadge>
            )}
          </>
        )}
      </a>
    </Link>
  );

  // Show tooltip when collapsed
  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {label}
          {badge && (
            <NavBadge variant={badge.variant}>
              {badge.content}
            </NavBadge>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
