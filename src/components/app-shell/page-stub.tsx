import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function PageStub({ icon: Icon, message }: { icon: LucideIcon; message: string }) {
  return (
    <div className="p-4 sm:p-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Icon className="size-10" />
          <p className="text-base">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
