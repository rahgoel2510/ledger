/**
 * The zero-rated export disclaimer, reproduced EXACTLY as specified in
 * CLAUDE.md. Every invoice PDF must carry it verbatim — do not reword,
 * re-case, or re-wrap this string. It is defined once, here, so there is
 * only ever one copy to get wrong.
 */
export const IGST_EXPORT_DISCLAIMER =
  "SUPPLY MEANT FOR EXPORT OF SERVICES UNDER LETTER OF UNDERTAKING (LUT) WITHOUT PAYMENT OF INTEGRATED TAX (IGST). REMITTANCE TO BE CREDITED IN FOREIGN CURRENCY TO RAHUL GOEL HUF BANK ACCOUNT.";

/** IGST on export of services under LUT is always zero — IGST Act s.16. Not a setting. */
export const IGST_RATE = 0;

export const IGST_LINE_LABEL = "IGST @ 0% (Zero-rated export of services under LUT)";
