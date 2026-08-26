"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { cn } from "@/lib/utils";
import { WifiOff } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export function TopBar() {
  const isOnline = useOnlineStatus();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="hidden md:inline-flex" />
      <Separator orientation="vertical" className="hidden h-5 md:block" />
      <div className="flex items-center gap-2 md:hidden">
        <BrandLogo size={28} />
        <span className="text-base font-semibold text-foreground">VrikshaFX</span>
      </div>
      <div className="flex-1" />
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium transition-opacity",
          isOnline ? "opacity-0" : "bg-status-overdue-bg text-status-overdue opacity-100"
        )}
        aria-live="polite"
      >
        {!isOnline && (
          <>
            <WifiOff className="size-3.5" />
            Offline
          </>
        )}
      </div>
    </header>
  );
}
