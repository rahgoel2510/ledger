import { Receipt } from "lucide-react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageStub } from "@/components/app-shell/page-stub";

export default function ExpensesPage() {
  return (
    <>
      <PageHeader title="Expenses" description="Chart of accounts and simple expense categorization." />
      <PageStub icon={Receipt} message="Expense ledger not yet built — see docs/modules/07-chart-of-accounts.md." />
    </>
  );
}
