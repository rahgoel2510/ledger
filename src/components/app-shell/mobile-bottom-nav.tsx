"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, SETTINGS_NAV_ITEM } from "@/components/app-shell/nav-items";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PRIMARY_ITEMS = NAV_ITEMS.filter((item) => item.primary);
const MORE_ITEMS = [...NAV_ITEMS.filter((item) => !item.primary), SETTINGS_NAV_ITEM];

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isItemActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const isMoreActive = MORE_ITEMS.some((item) => isItemActive(item.href));

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex h-20 items-stretch border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {PRIMARY_ITEMS.map((item) => {
          const active = isItemActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-sm font-medium",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="size-6" />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1 text-sm font-medium",
            isMoreActive ? "text-primary" : "text-muted-foreground"
          )}
        >
          <Menu className="size-6" />
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-3 px-4 pb-2">
            {MORE_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border p-4 text-sm font-medium",
                  isItemActive(item.href) ? "border-primary text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="size-6" />
                {item.label}
              </Link>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
