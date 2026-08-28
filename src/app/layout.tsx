import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { TopBar } from "@/components/app-shell/top-bar";
import { MobileBottomNav } from "@/components/app-shell/mobile-bottom-nav";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { RecurringDraftsRunner } from "@/components/recurring-drafts-runner";
import { SyncProvider } from "@/components/app-shell/sync-provider";
import { AppBootSplash } from "@/components/app-boot-splash";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VrikshaFX — Rahul Goel HUF",
  description: "Bookkeeping for foreign-currency invoicing, forex realization, and CA-ready reports.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VrikshaFX",
  },
};

export const viewport: Viewport = {
  themeColor: "#232b45",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <AppBootSplash>
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <TopBar />
                <main className="flex-1 pb-24 md:pb-0">{children}</main>
              </SidebarInset>
            </SidebarProvider>
            <MobileBottomNav />
            <ServiceWorkerRegister />
            <RecurringDraftsRunner />
            <SyncProvider />
            <Toaster position="top-center" richColors closeButton />
          </TooltipProvider>
        </AppBootSplash>
      </body>
    </html>
  );
}
