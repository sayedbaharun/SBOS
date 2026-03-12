import { ReactNode, useState } from "react";
import { Sidebar } from "./sidebar";
import TopBar from "./top-bar";
import FocusSessionTimer from "./deep-work/focus-session-timer";
import MobileBottomNav from "./mobile-bottom-nav";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

/**
 * Layout Component
 *
 * Main application layout with sidebar navigation and top bar.
 *
 * Structure:
 * - Sidebar: Fixed left navigation (collapsible on desktop, slides in on mobile)
 * - TopBar: Sticky top bar with notifications and user status
 * - Main content: Adjusts margin based on sidebar state
 *
 * Responsive behavior:
 * - Desktop (≥768px): Sidebar always visible, main content has left margin
 *   - Left margin: 260px when expanded, 60px when collapsed
 * - Mobile (<768px): Sidebar hidden by default, slides in when hamburger clicked
 *   - No left margin (sidebar overlays content)
 */
export default function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCollapsed] = useSidebarCollapsed();

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar - handles its own desktop/mobile visibility */}
      <Sidebar
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main content area with sidebar offset */}
      <div
        className={cn(
          "transition-all duration-200",
          isCollapsed ? "md:ml-[60px]" : "md:ml-[260px]"
        )}
      >
        {/* Top bar */}
        <TopBar onMenuClick={() => setMobileMenuOpen(true)} />

        {/* Page content */}
        <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 pb-24 sm:pb-24 safe-area-bottom">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <MobileBottomNav />

      {/* Global Focus Session Timer */}
      <FocusSessionTimer />
    </div>
  );
}
