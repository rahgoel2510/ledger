"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { startSyncEngine } from "@/lib/sync";

/** Starts/stops the Firestore sync engine as sign-in state changes. Renders nothing — see `sync.ts`. */
export function SyncProvider() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    return startSyncEngine(user.uid);
  }, [user]);

  return null;
}
