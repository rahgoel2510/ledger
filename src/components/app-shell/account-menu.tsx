"use client";

import { LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { firebaseConfigured } from "@/lib/firebase";

/**
 * Sign-in for multi-device sync. Absent entirely when no Firebase project is
 * configured (dev/CI with no `NEXT_PUBLIC_FIREBASE_*` env vars) — the app is
 * fully usable without ever seeing this, sync is additive (see `sync.ts`).
 */
export function AccountMenu() {
  const { user, loading, signIn, signOut } = useAuth();

  if (!firebaseConfigured) return null;

  if (!user) {
    return (
      <Button variant="outline" size="sm" disabled={loading} onClick={() => signIn().catch(onAuthError)}>
        <LogIn data-icon="inline-start" />
        Sign in to sync
      </Button>
    );
  }

  const initial = (user.displayName ?? user.email ?? "?").charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full">
          <Avatar size="sm">
            <AvatarImage src={user.photoURL ?? undefined} alt="" />
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="max-w-56 truncate font-normal">
          {user.displayName ?? user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut().catch(onAuthError)}>
          <LogOut data-icon="inline-start" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function onAuthError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Sign-in failed.");
}
