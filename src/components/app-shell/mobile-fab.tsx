"use client";

import type { LucideIcon } from "lucide-react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mobile-only primary action, floated just above the bottom nav.
 *
 * Module 0 US-4 requires the primary action of a screen to be within one thumb
 * stretch. The desktop equivalent lives in the page header, which on a phone
 * sits at the far top of the viewport — out of reach one-handed.
 */
export function MobileFab({
  onClick,
  label,
  icon: Icon = Plus,
  className,
}: {
  onClick: () => void;
  label: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "fixed right-4 z-30 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 md:hidden",
        className
      )}
      // Clears the 5rem bottom nav plus the home-indicator inset on iOS.
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom) + 1rem)" }}
    >
      <Icon className="size-6" />
    </button>
  );
}
