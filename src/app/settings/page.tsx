"use client";

import { useLiveQuery } from "dexie-react-hooks";

import { PageHeader } from "@/components/app-shell/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityProfileForm } from "@/components/settings/entity-profile-form";
import { CurrencySettings } from "@/components/settings/currency-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { SampleDataSettings } from "@/components/settings/sample-data-settings";
import { getEntityProfile } from "@/lib/entity-profile";

export default function SettingsPage() {
  const profile = useLiveQuery(() => getEntityProfile(), []);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Entity particulars, bank wire details, currencies, and local backup."
      />
      <div className="p-4 sm:p-6">
        <Tabs defaultValue="entity">
          <TabsList>
            <TabsTrigger value="entity">Entity &amp; bank</TabsTrigger>
            <TabsTrigger value="currencies">Currencies</TabsTrigger>
            <TabsTrigger value="backup">Backup</TabsTrigger>
          </TabsList>

          <TabsContent value="entity" className="mt-4">
            {profile === undefined ? (
              <div className="space-y-3">
                <Skeleton className="h-64 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : (
              <EntityProfileForm profile={profile} />
            )}
          </TabsContent>

          <TabsContent value="currencies" className="mt-4">
            <CurrencySettings />
          </TabsContent>

          <TabsContent value="backup" className="mt-4 space-y-4">
            <BackupSettings />
            <SampleDataSettings />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
