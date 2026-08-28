import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

/**
 * Firebase client (multi-device sync). Client-side only, same posture as the
 * rest of this app: no server, no secret held anywhere — these config values
 * identify the project publicly and carry no access on their own. Access
 * control is Firebase Auth (sign-in) plus Firestore security rules
 * (`firestore.rules`), which lock every read/write to one hardcoded owner UID.
 *
 * Static export means these must be build-time `NEXT_PUBLIC_*` env vars — see
 * `.github/workflows/deploy.yml` for how they reach the production build.
 */
const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * True once real config is present. `getAuth`/`getFirestore` both validate
 * eagerly and throw on an empty/placeholder API key — not just on first use —
 * so `auth`/`firestore` are only constructed when this is true. Every caller
 * (`use-auth.ts`, `sync.ts`) checks this before touching either, which is what
 * actually lets sync stay silently inert in dev/CI runs with no Firebase
 * project configured, rather than crashing the whole app at import time.
 */
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let firebaseApp: FirebaseApp | null = null;
export let auth: Auth | null = null;
export let firestore: Firestore | null = null;

if (firebaseConfigured) {
  // `getApps().length` guard: Next's dev server hot-reloads this module, and
  // `initializeApp` throws if called twice for the same app.
  firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  firestore = getFirestore(firebaseApp);
}
