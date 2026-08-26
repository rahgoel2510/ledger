import { Timer } from "lucide-react";
import { PageHeader } from "@/components/app-shell/page-header";
import { PageStub } from "@/components/app-shell/page-stub";

export default function ArAgingPage() {
  return (
    <>
      <PageHeader title="AR Aging" description="Outstanding invoices by days overdue." />
      <PageStub icon={Timer} message="AR aging dashboard not yet built — see docs/modules/06-ar-aging.md." />
    </>
  );
}
