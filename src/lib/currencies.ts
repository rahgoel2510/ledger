import type { Currency } from "@/lib/types";

/**
 * Default currency config. INR is the fixed base currency (Rahul Goel HUF's
 * reporting currency). Secondary currencies are seed data only — users can
 * add/deactivate more via settings; nothing about the currency list is
 * hardcoded into invoicing/forex logic elsewhere.
 */
export const DEFAULT_CURRENCIES: Currency[] = [
  { code: "INR", name: "Indian Rupee", symbol: "₹", isBase: true, active: true },
  { code: "USD", name: "US Dollar", symbol: "$", isBase: false, active: true },
  { code: "EUR", name: "Euro", symbol: "€", isBase: false, active: true },
  { code: "GBP", name: "British Pound", symbol: "£", isBase: false, active: false },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$", isBase: false, active: false },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", isBase: false, active: false },
];

export const BASE_CURRENCY_CODE = "INR";
