"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrandLogo } from "@/components/brand-logo";

const MIN_SPLASH_MS = 900;

/**
 * Brief animated-logo splash on first app boot. Children are always mounted
 * underneath — this only covers them until the minimum splash time elapses,
 * so it never blocks real content from loading in the background.
 */
export function AppBootSplash({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <>
      {children}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
          >
            <motion.div
              animate={{ scale: [1, 1.06, 1], opacity: [0.85, 1, 0.85] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <BrandLogo size={96} priority />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
