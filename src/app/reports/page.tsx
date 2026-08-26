import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageStub } from "@/components/app-shell/page-stub";

export default function ReportsPage() {
  return (
    <>
      <PageHeader
        title="Ledger & Reports"
        description="Double-entry ledger, receivables, and CA-ready P&L export."
      />
      <PageStub icon={BarChart3} message="Ledger & reports not yet built — see docs/modules/04-ledger-reports.md." />
    </>
  );
}
