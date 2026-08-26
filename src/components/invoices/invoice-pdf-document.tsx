import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  type DocumentProps,
} from "@react-pdf/renderer";

import type { EntityProfile, Invoice } from "@/lib/types";
import { IGST_EXPORT_DISCLAIMER, IGST_LINE_LABEL } from "@/lib/igst";
import { formatFxRate, invoiceTotalFcy, invoiceTotalInr, lineItemAmount, formatNumber } from "@/lib/money";
import { formatFinancialYear, parseIsoDate } from "@/lib/fy";

/**
 * A4 tax invoice for export of services under LUT.
 *
 * This module is only ever reached through a dynamic import from a click handler
 * (see lib/invoice-pdf.ts) — @react-pdf/renderer is large and has no business
 * being in the initial bundle or in the static-export prerender.
 *
 * Everything here renders from data already on the invoice record: the client
 * snapshot and the frozen invoice-date FX rate. Nothing is looked up live, so a
 * reissued PDF is byte-for-byte the same document as the original.
 */

const NAVY = "#232b45";
const BURGUNDY = "#6e2a34";
const GOLD = "#b8935f";
const INK = "#1c2333";
const MUTED = "#6b6456";
const RULE = "#eae4d8";

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontSize: 9, color: INK },

  masthead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  crest: { width: 46, height: 46, marginRight: 10 },
  entityName: { fontSize: 15, color: NAVY, fontWeight: 700 },
  entityMeta: { fontSize: 8, color: MUTED, marginTop: 2, lineHeight: 1.5 },

  docTitle: { fontSize: 16, color: BURGUNDY, fontWeight: 700, textAlign: "right", letterSpacing: 1 },
  docMetaRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 3 },
  docMetaLabel: { fontSize: 8, color: MUTED, marginRight: 6 },
  docMetaValue: { fontSize: 8, fontWeight: 700, minWidth: 92, textAlign: "right" },

  goldRule: { height: 2, backgroundColor: GOLD, marginTop: 12, marginBottom: 14 },
  rule: { height: 1, backgroundColor: RULE, marginVertical: 10 },

  columns: { flexDirection: "row", gap: 18 },
  column: { flex: 1 },
  blockLabel: {
    fontSize: 7,
    color: MUTED,
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  blockName: { fontSize: 10, fontWeight: 700, color: NAVY },
  blockLine: { fontSize: 8.5, color: INK, marginTop: 2, lineHeight: 1.5 },

  tableHead: {
    flexDirection: "row",
    backgroundColor: NAVY,
    paddingVertical: 6,
    paddingHorizontal: 6,
    marginTop: 16,
  },
  th: { color: "#ffffff", fontSize: 8, fontWeight: 700, letterSpacing: 0.4 },
  tr: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  colIndex: { width: 22 },
  colDesc: { flex: 1, paddingRight: 8 },
  colQty: { width: 52, textAlign: "right" },
  colRate: { width: 74, textAlign: "right" },
  colAmount: { width: 86, textAlign: "right" },

  totalsWrap: { alignItems: "flex-end", marginTop: 10 },
  totalsBox: { width: 260 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { fontSize: 8.5, color: MUTED, flex: 1, paddingRight: 8 },
  totalValue: { fontSize: 8.5, textAlign: "right" },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: "#f4efe7",
    marginTop: 4,
  },
  grandLabel: { fontSize: 10, fontWeight: 700, color: NAVY },
  grandValue: { fontSize: 10, fontWeight: 700, color: NAVY },
  inrNote: { fontSize: 7.5, color: MUTED, textAlign: "right", marginTop: 4, lineHeight: 1.5 },

  disclaimer: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: BURGUNDY,
    padding: 9,
    backgroundColor: "#fbf6f6",
  },
  disclaimerLabel: {
    fontSize: 7,
    letterSpacing: 1,
    color: BURGUNDY,
    fontWeight: 700,
    marginBottom: 4,
  },
  disclaimerText: { fontSize: 8, color: INK, lineHeight: 1.55, fontWeight: 700 },

  bank: { marginTop: 14, borderWidth: 1, borderColor: RULE, padding: 9 },
  bankGrid: { flexDirection: "row", flexWrap: "wrap" },
  bankCell: { width: "50%", paddingVertical: 2, paddingRight: 8 },
  bankLabel: { fontSize: 7, color: MUTED, letterSpacing: 0.5 },
  bankValue: { fontSize: 9, fontWeight: 700, marginTop: 1 },

  notes: { marginTop: 14 },
  notesText: { fontSize: 8.5, color: INK, lineHeight: 1.5 },

  footer: {
    position: "absolute",
    bottom: 22,
    left: 36,
    right: 36,
    borderTopWidth: 1,
    borderTopColor: RULE,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontSize: 7, color: MUTED },
});

export interface InvoicePdfProps {
  invoice: Invoice;
  profile: EntityProfile;
  /** Data URI for the crest. Omitted when it could not be loaded — the invoice still renders. */
  logoDataUri?: string;
}

export function InvoicePdfDocument({ invoice, profile, logoDataUri }: InvoicePdfProps) {
  const totalFcy = invoiceTotalFcy(invoice);
  const totalInr = invoiceTotalInr(invoice);
  const documentProps: DocumentProps = {
    title: `${invoice.serialNumber} — ${invoice.clientSnapshot.name}`,
    author: profile.legalName,
    subject: "Tax Invoice — Export of Services under LUT",
  };

  return (
    <Document {...documentProps}>
      <Page size="A4" style={styles.page}>
        <View style={styles.masthead}>
          <View style={[styles.columns, { flex: 1 }]}>
            {/* @react-pdf Image renders into a PDF, not the DOM - it has no alt prop. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logoDataUri && <Image src={logoDataUri} style={styles.crest} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.entityName}>{profile.legalName}</Text>
              {splitLines(profile.address).map((line, i) => (
                <Text key={i} style={styles.entityMeta}>
                  {line}
                </Text>
              ))}
              {profile.gstin && <Text style={styles.entityMeta}>GSTIN: {profile.gstin}</Text>}
              {profile.pan && <Text style={styles.entityMeta}>PAN: {profile.pan}</Text>}
              {profile.lutNumber && <Text style={styles.entityMeta}>LUT: {profile.lutNumber}</Text>}
              {(profile.email || profile.phone) && (
                <Text style={styles.entityMeta}>
                  {[profile.email, profile.phone].filter(Boolean).join("  ·  ")}
                </Text>
              )}
            </View>
          </View>

          <View>
            <Text style={styles.docTitle}>TAX INVOICE</Text>
            <MetaRow label="Invoice No." value={invoice.serialNumber} />
            <MetaRow label="Invoice Date" value={formatDate(invoice.invoiceDate)} />
            <MetaRow label="Due Date" value={formatDate(invoice.dueDate)} />
            <MetaRow label="Financial Year" value={formatFinancialYear(invoice.financialYear)} />
          </View>
        </View>

        <View style={styles.goldRule} />

        <View style={styles.columns}>
          <View style={styles.column}>
            <Text style={styles.blockLabel}>Bill To</Text>
            <Text style={styles.blockName}>{invoice.clientSnapshot.name}</Text>
            {splitLines(invoice.clientSnapshot.billingAddress).map((line, i) => (
              <Text key={i} style={styles.blockLine}>
                {line}
              </Text>
            ))}
            <Text style={styles.blockLine}>{invoice.clientSnapshot.country}</Text>
            {invoice.clientSnapshot.taxId && (
              <Text style={styles.blockLine}>Tax ID: {invoice.clientSnapshot.taxId}</Text>
            )}
            {invoice.clientSnapshot.primaryContact && (
              <Text style={styles.blockLine}>
                Attn: {invoice.clientSnapshot.primaryContact}
              </Text>
            )}
          </View>

          <View style={styles.column}>
            <Text style={styles.blockLabel}>Supply Details</Text>
            <Text style={styles.blockLine}>Nature of supply: Export of Services</Text>
            <Text style={styles.blockLine}>Place of supply: {invoice.clientSnapshot.country}</Text>
            <Text style={styles.blockLine}>Invoice currency: {invoice.currency}</Text>
            <Text style={styles.blockLine}>
              Exchange rate on invoice date: 1 {invoice.currency} = INR{" "}
              {formatFxRate(invoice.invoiceDateFxRate)}
            </Text>
          </View>
        </View>

        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.colIndex]}>#</Text>
          <Text style={[styles.th, styles.colDesc]}>DESCRIPTION OF SERVICES</Text>
          <Text style={[styles.th, styles.colQty]}>QTY</Text>
          <Text style={[styles.th, styles.colRate]}>RATE</Text>
          <Text style={[styles.th, styles.colAmount]}>AMOUNT ({invoice.currency})</Text>
        </View>

        {invoice.lineItems.map((item, index) => (
          <View key={item.id} style={styles.tr} wrap={false}>
            <Text style={styles.colIndex}>{index + 1}</Text>
            <Text style={styles.colDesc}>{item.description}</Text>
            <Text style={styles.colQty}>{formatNumber(item.quantity, "en-US")}</Text>
            <Text style={styles.colRate}>{formatNumber(item.unitPrice, "en-US")}</Text>
            <Text style={styles.colAmount}>{formatNumber(lineItemAmount(item), "en-US")}</Text>
          </View>
        ))}

        <View style={styles.totalsWrap}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>
                {invoice.currency} {formatNumber(totalFcy, "en-US")}
              </Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{IGST_LINE_LABEL}</Text>
              <Text style={styles.totalValue}>{invoice.currency} 0.00</Text>
            </View>
            <View style={styles.grandRow}>
              <Text style={styles.grandLabel}>Total Due</Text>
              <Text style={styles.grandValue}>
                {invoice.currency} {formatNumber(totalFcy, "en-US")}
              </Text>
            </View>
            <Text style={styles.inrNote}>
              INR equivalent at invoice-date rate: INR {formatNumber(totalInr)}
              {"\n"}(for books of account only — remittance is receivable in {invoice.currency})
            </Text>
          </View>
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerLabel}>DECLARATION</Text>
          <Text style={styles.disclaimerText}>{IGST_EXPORT_DISCLAIMER}</Text>
        </View>

        <View style={styles.bank}>
          <Text style={styles.blockLabel}>Bank Details for International Wire Transfer</Text>
          <View style={styles.bankGrid}>
            <BankCell label="ACCOUNT NAME" value={profile.legalName} />
            <BankCell label="BANK NAME" value={profile.bankName} />
            <BankCell label="ACCOUNT NUMBER" value={profile.bankAccountNumber} />
            <BankCell label="IFSC CODE" value={profile.bankIfsc} />
            <BankCell label="SWIFT / BIC CODE" value={profile.bankSwift} />
            {profile.bankBranch ? <BankCell label="BRANCH" value={profile.bankBranch} /> : null}
          </View>
        </View>

        {invoice.notes ? (
          <View style={styles.notes}>
            <Text style={styles.blockLabel}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {invoice.serialNumber} · Computer-generated invoice · No signature required
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.docMetaRow}>
      <Text style={styles.docMetaLabel}>{label}</Text>
      <Text style={styles.docMetaValue}>{value}</Text>
    </View>
  );
}

function BankCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.bankCell}>
      <Text style={styles.bankLabel}>{label}</Text>
      <Text style={styles.bankValue}>{value}</Text>
    </View>
  );
}

function splitLines(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Invoices read better with an unambiguous day-month-year than with an ISO string. */
function formatDate(isoDate: string): string {
  return parseIsoDate(isoDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
