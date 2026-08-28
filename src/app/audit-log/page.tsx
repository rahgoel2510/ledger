import { History } from "lucide-react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageStub } from "@/components/app-shell/page-stub";

export default function AuditLogPage() {
  return (
    <>
      <PageHeader title="Audit Log" description="Immutable record of invoice, payment, and override actions." />
      <PageStub icon={History} message="Audit trail not yet built — see docs/modules/08-audit-trail.md." />
    </>
  );
}
