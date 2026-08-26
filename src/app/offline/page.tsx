import { CloudOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Offline fallback for routes the service worker has never cached. Precached at
 * install time (see public/sw.js) so it is always available — without it, a
 * navigation to a never-visited route while offline lands on the browser's own
 * error page, which module 0 US-2 rules out.
 */
export default function OfflinePage() {
  return (
    <div className="p-4 sm:p-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <CloudOff className="size-10 text-muted-foreground" />
          <h1 className="text-xl font-semibold">This page isn&apos;t available offline yet</h1>
          <p className="max-w-md text-base text-muted-foreground">
            You haven&apos;t opened this screen since installing the app, so it hasn&apos;t been
            cached. Everything you have already visited still works — and all your data is stored
            on this device, not in the cloud.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
