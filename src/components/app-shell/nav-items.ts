import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  History,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  Timer,
  Users,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Included in the mobile bottom nav's primary slots (max 4 + "More"). */
  primary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, primary: true },
  { href: "/invoices", label: "Invoices", icon: ScrollText, primary: true },
  { href: "/clients", label: "Clients", icon: Users, primary: true },
  { href: "/remittances", label: "Remittances", icon: ArrowLeftRight },
  { href: "/reports", label: "Ledger & Reports", icon: BarChart3, primary: true },
  { href: "/ar-aging", label: "AR Aging", icon: Timer },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/audit-log", label: "Audit Log", icon: History },
];

export const SETTINGS_NAV_ITEM: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
};
