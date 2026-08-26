import { ArrowLeftRight } from "lucide-react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageStub } from "@/components/app-shell/page-stub";

export default function RemittancesPage() {
  return (
    <>
      <PageHeader
        title="Remittances"
        description="Log received payments and realize forex gain/loss against invoices."
      />
      <PageStub
        icon={ArrowLeftRight}
        message="Forex & remittance realization not yet built — see docs/modules/03-forex-remittance.md."
      />
    </>
  );
}
