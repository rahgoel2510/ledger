import type { InvoiceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
};

const STATUS_CLASSES: Record<InvoiceStatus, string> = {
  draft: "bg-status-draft-bg text-status-draft",
  sent: "bg-status-sent-bg text-status-sent",
  paid: "bg-status-paid-bg text-status-paid",
  overdue: "bg-status-overdue-bg text-status-overdue",
};

export function StatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        STATUS_CLASSES[status],
        className
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}
