import { useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Heart,
  BookOpen,
  Settings,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  User,
  X,
  Zap,
  TrendingUp,
  Users,
  CheckSquare,
  Sparkles,
  Calendar,
  Plug,
  Layers,
  DollarSign,
  Inbox,
  Bot,
} from "lucide-react";
import NavSection, { NavItemConfig } from "./nav-section";
import VenturesNavSection from "./ventures-nav-section";
import NavItem from "./nav-item";
import Logo from "../logo";
import { Button } from "@/components/ui/button";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

/**
 * Navigation configuration
 *
 * CUSTOMIZATION GUIDE:
 * ====================
 *
 * To customize the navigation structure, modify the sections below:
 *
 * 1. CHANGING SECTION LABELS:
 *    Update the 'label' property in each section object
 *
 * 2. ADDING/REMOVING NAV ITEMS:
 *    Add or remove items from the 'items' array
 *    Each item needs: href, icon, label, and optional badge
 *
 * 3. UPDATING ICONS:
 *    Import new icons from 'lucide-react' and update the 'icon' property
 *
 * 4. ADDING BADGES:
 *    Add a 'badge' property with content and variant:
 *    badge: { content: "3", variant: "alert" }
 *    Variants: 'default' | 'alert' | 'warning' | 'success' | 'info'
 *
 * 5. REORDERING SECTIONS:
 *    Change the order of objects in the navigationSections array
 *
 * 6. DYNAMIC BADGES:
 *    To make badges dynamic, move this config to a component that uses state/props
 *    and pass the badge values from your data (e.g., task counts, notifications)
 *
 * Example with dynamic badge:
 * ```tsx
 * const pendingTasksCount = usePendingTasks(); // Your hook
 * const sections = [
 *   {
 *     label: "Main",
 *     items: [
 *       {
 *         href: "/tasks",
 *         icon: CheckSquare,
 *         label: "Tasks",
 *         badge: pendingTasksCount > 0
 *           ? { content: pendingTasksCount, variant: "alert" }
 *           : undefined
 *       }
 *     ]
 *   }
 * ];
 * ```
 */
const navigationSections: Array<{ label: string; items: NavItemConfig[]; defaultExpanded?: boolean }> = [
  {
    label: "Daily",
    items: [
      {
        href: "/dashboard",
        icon: LayoutDashboard,
        label: "Dashboard",
      },
      {
        href: "/morning",
        icon: Sun,
        label: "Morning Ritual",
      },
      {
        href: "/capture",
        icon: Zap,
        label: "Capture",
      },
      {
        href: "/calendar",
        icon: Calendar,
        label: "Calendar",
      },
      {
        href: "/evening",
        icon: Moon,
        label: "Evening Review",
      },
    ],
  },
  {
    label: "Work",
    items: [
      {
        href: "/tasks",
        icon: CheckSquare,
        label: "Tasks",
      },
      {
        href: "/knowledge",
        icon: BookOpen,
        label: "Knowledge",
      },
      {
        href: "/trading",
        icon: TrendingUp,
        label: "Trading",
      },
      {
        href: "/agents",
        icon: Users,
        label: "Agents",
      },
      {
        href: "/research-inbox",
        icon: Inbox,
        label: "Research Inbox",
      },
    ],
  },
  {
    label: "Life",
    items: [
      {
        href: "/health-hub",
        icon: Heart,
        label: "Health",
      },
      {
        href: "/finance",
        icon: DollarSign,
        label: "Finance",
      },
      {
        href: "/people",
        icon: User,
        label: "People",
      },
    ],
  },
  {
    label: "Settings",
    defaultExpanded: false,
    items: [
      {
        href: "/settings",
        icon: User,
        label: "Profile",
      },
      {
        href: "/settings/ai",
        icon: Sparkles,
        label: "AI Settings",
      },
      {
        href: "/settings/integrations",
        icon: Plug,
        label: "Integrations",
      },
      {
        href: "/settings/categories",
        icon: Layers,
        label: "Categories",
      },
      {
        href: "/settings/external-agents",
        icon: Bot,
        label: "External Agents",
      },
    ],
  },
];

export interface SidebarProps {
  /** Whether the sidebar is open (mobile only) */
  isOpen?: boolean;
  /** Callback when sidebar should close (mobile only) */
  onClose?: () => void;
}

/**
 * Sidebar Component
 *
 * Main navigation sidebar with collapse functionality, sections, and responsive behavior.
 *
 * Features:
 * - Collapsible on desktop (260px expanded, 60px collapsed)
 * - Full-height with sticky positioning
 * - Sections with labels and visual separators
 * - Active state tracking based on current route
 * - Persistent collapsed state (localStorage)
 * - Mobile responsive (slides in from left with backdrop)
 * - Keyboard accessible
 * - Smooth animations
 *
 * Desktop behavior:
 * - Collapsed state persists across sessions
 * - Toggle button to expand/collapse
 * - Tooltips show labels when collapsed
 *
 * Mobile behavior (< 768px):
 * - Hidden by default
 * - Slides in from left when opened
 * - Dark backdrop overlay
 * - Close on outside tap or nav item click
 * - Close button in header
 *
 * @example
 * ```tsx
 * // Desktop (self-managed state)
 * <Sidebar />
 *
 * // Mobile (controlled from parent)
 * <Sidebar isOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
 * ```
 */
export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  // Collapsed state (desktop only) - shared across components
  const [isCollapsed, setIsCollapsed] = useSidebarCollapsed();

  // Handle escape key to close mobile menu
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && onClose) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      // Prevent body scroll when mobile menu is open
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-200",
          "flex flex-col",
          // Desktop: always visible, collapsible width
          "hidden md:flex",
          isCollapsed ? "md:w-[60px]" : "md:w-[260px]",
          // Mobile: slide in from left
          "md:translate-x-0",
          isOpen ? "flex translate-x-0" : "-translate-x-full",
          "w-[260px]" // Mobile always full width when open
        )}
        aria-label="Main navigation"
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center justify-between h-16 px-4 border-b border-sidebar-border",
            isCollapsed && "md:justify-center md:px-2"
          )}
        >
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <Logo />
            </div>
          )}

          {/* Mobile close button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Navigation sections */}
        <div className="flex-1 overflow-y-auto px-3 py-4">
          {navigationSections.map((section, index) => (
            <div key={section.label}>
              <NavSection
                label={section.label}
                items={section.items}
                isCollapsed={isCollapsed}
                onItemClick={onClose} // Close mobile menu on nav
                defaultExpanded={section.defaultExpanded}
              />
              {/* Insert VenturesNavSection after Daily section */}
              {section.label === "Daily" && (
                <VenturesNavSection
                  isCollapsed={isCollapsed}
                  onItemClick={onClose}
                />
              )}
            </div>
          ))}
        </div>

        {/* Desktop collapse toggle */}
        <div className="hidden md:block border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={toggleCollapse}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <div className="flex items-center gap-2 w-full">
                <ChevronLeft className="h-4 w-4" />
                <span className="text-xs text-muted-foreground">Collapse</span>
              </div>
            )}
          </Button>
        </div>
      </aside>
    </>
  );
}
