import { useState, useCallback } from "react";
import { Menu, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import NotificationCenter from "./notifications/notification-center";
import Logo from "./logo";

export interface TopBarProps {
  /** Callback to open mobile menu */
  onMenuClick: () => void;
}

/**
 * TopBar Component
 *
 * Minimal top navigation bar that works alongside the sidebar.
 *
 * Features:
 * - Logo/brand (hidden on desktop when sidebar is visible)
 * - Hamburger menu button (mobile only)
 * - Notification center
 * - User status indicator
 * - Sticky positioning
 *
 * Desktop: Minimal bar with just notifications and user status
 * Mobile: Includes hamburger button to open sidebar
 */
export default function TopBar({ onMenuClick }: TopBarProps) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries();
    // Keep spinner visible briefly so user sees feedback
    setTimeout(() => setIsRefreshing(false), 600);
  }, [queryClient]);

  return (
    <header className="sticky top-0 z-30 border-b bg-card border-border">
      <div className="flex items-center justify-between h-16 px-4">
        {/* Left side - Mobile menu + Logo */}
        <div className="flex items-center gap-3">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Logo - visible on mobile only */}
          <div className="md:hidden">
            <Logo />
          </div>
        </div>

        {/* Right side - Refresh + Notifications + User status */}
        <div className="flex items-center gap-3">
          {/* Refresh button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
            aria-label="Refresh data"
            className="h-9 w-9"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>

          {/* Notification Center */}
          <NotificationCenter />

          {/* User status indicator */}
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" aria-label="Online status"></div>
            <span className="text-sm text-muted-foreground hidden sm:inline">Online</span>
          </div>
        </div>
      </div>
    </header>
  );
}
