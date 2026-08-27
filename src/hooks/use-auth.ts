"use client";

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth, firebaseConfigured } from "@/lib/firebase";

/**
 * Sign-in is optional everywhere in this app — it only starts multi-device
 * sync (see `sync.ts`) on top of an otherwise unchanged, fully offline Dexie
 * app. `user` stays `null` until someone signs in, and nothing here blocks
 * any page from rendering while it's null.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
    });
  }, []);

  async function signIn() {
    if (!auth) return;
    await signInWithPopup(auth, new GoogleAuthProvider());
  }

  async function signOut() {
    if (!auth) return;
    await firebaseSignOut(auth);
  }

  return { user, loading, signIn, signOut };
}
