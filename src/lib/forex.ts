import { round2 } from "@/lib/money";

/**
 * Realized forex gain/loss, exactly as specified in CLAUDE.md:
 *
 *   Realized Forex Gain/Loss = INR Credited - (FCY Received x Invoice Date FX Rate) - Bank Charges
 *
 * `invoiceDateFxRate` is the rate frozen on the invoice at creation time. Never
 * pass a remittance-date or freshly fetched rate here — the whole point of the
 * figure is the variance against the rate the income was booked at.
 *
 * Note this single number folds two economically distinct effects together: the
 * pure FX variance and the bank's charges. The ledger splits them back apart so
 * the P&L can show bank charges on their own line — see `postRemittance` in
 * lib/ledger.ts, which nets to exactly this value.
 */
export function realizedForexGainLoss(input: {
  inrCredited: number;
  fcyReceived: number;
  invoiceDateFxRate: number;
  bankCharges: number;
}): number {
  const bookedInr = input.fcyReceived * input.invoiceDateFxRate;
  return round2(input.inrCredited - bookedInr - input.bankCharges);
}

/** The INR value the receivable was originally booked at for this much FCY. */
export function bookedInrValue(fcyAmount: number, invoiceDateFxRate: number): number {
  return round2(fcyAmount * invoiceDateFxRate);
}

/** The FX variance alone, excluding bank charges — the figure the ledger posts. */
export function pureForexVariance(input: {
  inrCredited: number;
  fcyReceived: number;
  invoiceDateFxRate: number;
}): number {
  return round2(input.inrCredited - bookedInrValue(input.fcyReceived, input.invoiceDateFxRate));
}
