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
import { BASE_CURRENCY_CODE } from "@/lib/currencies";
import { IGST_EXPORT_DISCLAIMER, IGST_LINE_LABEL } from "@/lib/igst";
import {
  REVERSE_CHARGE_NO,
  REVERSE_CHARGE_YES,
  SIGNATURE_CAPTION,
  US_SALES_TAX_STATEMENT,
  US_SOURCE_STATEMENT,
  amountInWords,
  isUnitedStates,
} from "@/lib/compliance";
import {
  annexureLines,
  formatFxRate,
  formatNumber,
  gstHalves,
  invoiceSubtotalFcy,
  invoiceTaxFcy,
  invoiceTotalFcy,
  invoiceTotalInr,
  invoiceTotalHours,
  lineItemAmount,
  lineItemQuantity,
  taskHours,
} from "@/lib/money";
import { formatFinancialYear, parseIsoDate } from "@/lib/fy";

/**
 * A4 tax invoice.
 *
 * Two faces, decided by the invoice's own `placeOfSupply`: an export of services
 * zero-rated under LUT, which carries the mandatory IGST declaration, or a
 * domestic supply, which carries the GST rate the user stated. The declaration
 * prints only on an export — putting it on a domestic invoice would be a false
 * statement about the supply — and the rate printed is never one the app
 * worked out for itself.
 *
 * This module is only ever reached through a dynamic import from a click handler
 * (see lib/invoice-pdf.ts) — @react-pdf/renderer is large and has no business
 * being in the initial bundle or in the static-export prerender.
 *
 * A line broken into tasks bills as one figure here and carries its detail on a
 * second page, "Annexure A" — the shape a consultancy invoice usually takes: a
 * clean face for the payables desk, a dated task-by-task record behind it. The
 * annexure page only exists when some line actually has tasks.
 *
 * The particulars it prints are the ones Rule 46 of the CGST Rules lists, plus
 * what a US payables desk needs to book and pay a foreign invoice without
 * withholding -- `compliance.ts` is the authority on both, and the reason each
 * line is here. Nothing on this page assesses a liability: the reverse-charge
 * line and the US source statement are statements of fact about the supply,
 * which is where CLAUDE.md's tax boundary puts them.
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
  colDate: { width: 56 },
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

  hoursRow: { paddingVertical: 6, paddingHorizontal: 6 },
  hoursText: { fontSize: 8, color: MUTED, fontWeight: 700 },

  annexRef: { fontSize: 7.5, color: BURGUNDY, marginTop: 2 },
  annexTitle: { fontSize: 14, color: BURGUNDY, fontWeight: 700, letterSpacing: 1 },
  annexSubtitle: { fontSize: 9, color: NAVY, fontWeight: 700, marginTop: 2 },
  annexNote: { fontSize: 8, color: MUTED, marginTop: 4, lineHeight: 1.5 },
  annexSection: {
    marginTop: 16,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: GOLD,
  },
  annexSectionLabel: { fontSize: 7, color: MUTED, letterSpacing: 1 },
  annexSectionName: { fontSize: 10, color: NAVY, fontWeight: 700, marginTop: 1 },
  colTaskDate: { width: 66 },
  colTaskDesc: { flex: 1, paddingRight: 8 },
  colTaskHours: { width: 56, textAlign: "right" },
  annexSubtotal: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  annexSubtotalLabel: { fontSize: 8, color: MUTED, marginRight: 10 },
  annexSubtotalValue: { fontSize: 8, fontWeight: 700, width: 56, textAlign: "right" },
  annexTotalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: "#f4efe7",
  },
  annexTotalLabel: { fontSize: 10, fontWeight: 700, color: NAVY, marginRight: 10 },
  annexTotalValue: { fontSize: 10, fontWeight: 700, color: NAVY, width: 56, textAlign: "right" },

  notes: { marginTop: 14 },
  notesText: { fontSize: 8.5, color: INK, lineHeight: 1.5 },

  wordsRow: { marginTop: 8, borderWidth: 1, borderColor: RULE, padding: 6 },
  wordsLabel: { fontSize: 7, color: MUTED, letterSpacing: 1, marginBottom: 3 },
  wordsText: { fontSize: 8.5, color: INK, fontWeight: 700, lineHeight: 1.5 },

  statements: { marginTop: 10 },
  statementText: { fontSize: 7.5, color: MUTED, lineHeight: 1.5, marginTop: 3 },

  signRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  signBox: { width: 210, alignItems: "center" },
  signFor: { fontSize: 8.5, color: NAVY, fontWeight: 700 },
  signSpace: { height: 22 },
  signLine: { height: 1, backgroundColor: MUTED, width: "100%" },
  signName: { fontSize: 8.5, fontWeight: 700, marginTop: 3 },
  signCaption: { fontSize: 7, color: MUTED, marginTop: 1, letterSpacing: 0.5 },

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
  const isExport = invoice.placeOfSupply !== "domestic";
  // An invoice raised in rupees has no conversion to state, and printing
  // "1 INR = INR 1.0000" next to a rupee total invites the reader to look for
  // a foreign leg that is not there.
  const isBaseCurrency = invoice.currency === BASE_CURRENCY_CODE;
  const subtotalFcy = invoiceSubtotalFcy(invoice);
  const taxFcy = invoiceTaxFcy(invoice);
  const totalFcy = invoiceTotalFcy(invoice);
  const totalInr = invoiceTotalInr(invoice);
  const split = gstHalves(taxFcy);

  // Date and per-hour columns appear only when the work was actually billed by
  // the hour. On a flat retainer they would be empty columns implying a record
  // of consultations that was never kept.
  const isHourly = invoice.lineItems.some((item) => item.unit === "hours");
  const hourlyLines = invoice.lineItems.filter((item) => item.unit === "hours");
  const totalHours = invoiceTotalHours(invoice);
  const annexed = annexureLines(invoice);

  // Rule 46(o): the address of delivery is stated where it differs from the
  // billing address. Where it is not recorded at all the two are the same place
  // -- a service delivered to the entity that ordered it -- so there is nothing
  // to add, and repeating the billing address under a second heading would tell
  // the reader nothing.
  const deliveryAddress = invoice.clientSnapshot.deliveryAddress?.trim() ?? "";
  const deliveryDiffers =
    deliveryAddress !== "" &&
    deliveryAddress !== (invoice.clientSnapshot.billingAddress ?? "").trim();
  const isUsRecipient = isUnitedStates(invoice.clientSnapshot.country);
  const supplierState = [profile.state, profile.stateCode && `(${profile.stateCode})`]
    .filter(Boolean)
    .join(" ");

  const documentProps: DocumentProps = {
    title: `${invoice.serialNumber} — ${invoice.clientSnapshot.name}`,
    author: profile.legalName,
    subject: isExport
      ? "Tax Invoice — Export of Services under LUT"
      : "Tax Invoice — Domestic Supply of Services",
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
              {supplierState ? (
                <Text style={styles.entityMeta}>State: {supplierState}</Text>
              ) : null}
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
            {invoice.poNumber ? <MetaRow label="PO / Reference" value={invoice.poNumber} /> : null}
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
            {deliveryDiffers ? (
              <>
                <Text style={[styles.blockLabel, { marginTop: 8 }]}>Address of Delivery</Text>
                {splitLines(deliveryAddress).map((line, i) => (
                  <Text key={i} style={styles.blockLine}>
                    {line}
                  </Text>
                ))}
              </>
            ) : null}
          </View>

          <View style={styles.column}>
            <Text style={styles.blockLabel}>Supply Details</Text>
            <Text style={styles.blockLine}>
              Nature of supply: {isExport ? "Export of Services" : "Domestic Supply of Services"}
            </Text>
            {/* Rule 46(n) wants the State named on a domestic supply; on an
                export the place of supply is outside India and 46(r) wants the
                country of destination said in as many words. */}
            <Text style={styles.blockLine}>
              Place of supply:{" "}
              {isExport
                ? `Outside India - ${invoice.clientSnapshot.country}`
                : (invoice.clientSnapshot.state ?? invoice.clientSnapshot.country)}
            </Text>
            {isExport ? (
              <Text style={styles.blockLine}>
                Country of destination: {invoice.clientSnapshot.country}
              </Text>
            ) : null}
            {/* Rule 46(p). Stated either way -- silence is not an answer, and
                the recipient's own return depends on this line. */}
            <Text style={styles.blockLine}>
              {invoice.reverseCharge ? REVERSE_CHARGE_YES : REVERSE_CHARGE_NO}
            </Text>
            {invoice.sacCode ? (
              <Text style={styles.blockLine}>SAC code: {invoice.sacCode}</Text>
            ) : null}
            {!isExport && invoice.clientSnapshot.gstin ? (
              <Text style={styles.blockLine}>Recipient GSTIN: {invoice.clientSnapshot.gstin}</Text>
            ) : null}
            <Text style={styles.blockLine}>Invoice currency: {invoice.currency}</Text>
            {isBaseCurrency ? null : (
              <Text style={styles.blockLine}>
                Exchange rate on invoice date: 1 {invoice.currency} = INR{" "}
                {formatFxRate(invoice.invoiceDateFxRate)}
              </Text>
            )}
            {invoice.periodStart && invoice.periodEnd ? (
              <Text style={styles.blockLine}>
                Billing period: {formatDate(invoice.periodStart)} to {formatDate(invoice.periodEnd)}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.colIndex]}>#</Text>
          {isHourly ? <Text style={[styles.th, styles.colDate]}>DATE</Text> : null}
          <Text style={[styles.th, styles.colDesc]}>
            {isHourly ? "CONSULTATION / SERVICE" : "DESCRIPTION OF SERVICES"}
          </Text>
          <Text style={[styles.th, styles.colQty]}>{isHourly ? "HOURS" : "QTY"}</Text>
          <Text style={[styles.th, styles.colRate]}>{isHourly ? "RATE/HOUR" : "RATE"}</Text>
          <Text style={[styles.th, styles.colAmount]}>AMOUNT ({invoice.currency})</Text>
        </View>

        {invoice.lineItems.map((item, index) => {
          const tasks = item.tasks ?? [];
          return (
            <View key={item.id} style={styles.tr} wrap={false}>
              <Text style={styles.colIndex}>{index + 1}</Text>
              {isHourly ? (
                <Text style={styles.colDate}>{item.date ? formatDate(item.date) : ""}</Text>
              ) : null}
              <View style={styles.colDesc}>
                <Text>{item.description}</Text>
                {tasks.length > 0 ? (
                  <Text style={styles.annexRef}>
                    Itemised in Annexure A — {tasks.length}{" "}
                    {tasks.length === 1 ? "task" : "tasks"},{" "}
                    {formatDate(earliestTaskDate(tasks))} to {formatDate(latestTaskDate(tasks))}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.colQty}>
                {formatNumber(lineItemQuantity(item), "en-US")}
              </Text>
              <Text style={styles.colRate}>{formatNumber(item.unitPrice, "en-US")}</Text>
              <Text style={styles.colAmount}>{formatNumber(lineItemAmount(item), "en-US")}</Text>
            </View>
          );
        })}

        {isHourly ? (
          <View style={styles.hoursRow}>
            <Text style={styles.hoursText}>
              Total consultation hours: {formatNumber(totalHours, "en-US")} across{" "}
              {hourlyLines.length} billed {hourlyLines.length === 1 ? "line" : "lines"}
              {annexed.length > 0 ? " · itemised task breakdown at Annexure A" : ""}
            </Text>
          </View>
        ) : null}

        <View style={styles.totalsWrap}>
          <View style={styles.totalsBox}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal</Text>
              <Text style={styles.totalValue}>
                {invoice.currency} {formatNumber(subtotalFcy, "en-US")}
              </Text>
            </View>
            {isExport ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{IGST_LINE_LABEL}</Text>
                <Text style={styles.totalValue}>{invoice.currency} 0.00</Text>
              </View>
            ) : invoice.taxTreatment === "cgst_sgst" ? (
              <>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>CGST @ {invoice.gstRate / 2}%</Text>
                  <Text style={styles.totalValue}>
                    {invoice.currency} {formatNumber(split.half, "en-US")}
                  </Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>SGST @ {invoice.gstRate / 2}%</Text>
                  <Text style={styles.totalValue}>
                    {invoice.currency} {formatNumber(split.rest, "en-US")}
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>IGST @ {invoice.gstRate}%</Text>
                <Text style={styles.totalValue}>
                  {invoice.currency} {formatNumber(taxFcy, "en-US")}
                </Text>
              </View>
            )}
            <View style={styles.grandRow}>
              <Text style={styles.grandLabel}>Total Due</Text>
              <Text style={styles.grandValue}>
                {invoice.currency} {formatNumber(totalFcy, "en-US")}
              </Text>
            </View>
            {isBaseCurrency ? null : (
              <Text style={styles.inrNote}>
                INR equivalent at invoice-date rate: INR {formatNumber(totalInr)}
                {"\n"}(for books of account only — remittance is receivable in {invoice.currency})
              </Text>
            )}
          </View>
        </View>

        {invoice.igstDisclaimerShown ? (
          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerLabel}>DECLARATION</Text>
            <Text style={styles.disclaimerText}>{IGST_EXPORT_DISCLAIMER}</Text>
          </View>
        ) : null}

        <View style={styles.bank}>
          <Text style={styles.blockLabel}>
            {isExport ? "Bank Details for International Wire Transfer" : "Bank Details for Payment"}
          </Text>
          <View style={styles.bankGrid}>
            <BankCell label="ACCOUNT NAME" value={profile.legalName} />
            <BankCell label="BANK NAME" value={profile.bankName} />
            <BankCell label="ACCOUNT NUMBER" value={profile.bankAccountNumber} />
            <BankCell label="IFSC CODE" value={profile.bankIfsc} />
            {/* SWIFT identifies the bank to an overseas remitter. A domestic
                payer routes on IFSC alone and has no use for it. */}
            {isExport ? <BankCell label="SWIFT / BIC CODE" value={profile.bankSwift} /> : null}
            {profile.bankBranch ? <BankCell label="BRANCH" value={profile.bankBranch} /> : null}
          </View>
        </View>

        {/* The total spelled out: standard on an Indian invoice, and the check
            against a figure altered after issue. */}
        <View style={styles.wordsRow}>
          <Text style={styles.wordsLabel}>TOTAL IN WORDS</Text>
          <Text style={styles.wordsText}>{amountInWords(totalFcy, invoice.currency)}</Text>
        </View>

        {invoice.notes ? (
          <View style={styles.notes}>
            <Text style={styles.blockLabel}>Notes</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        ) : null}

        {/* For a US payer only. Both lines state where the work happened and
            what the supplier is -- which is what lets the payer release the
            full amount instead of withholding under Chapter 3. */}
        {isUsRecipient ? (
          <View style={styles.statements}>
            <Text style={styles.blockLabel}>
              For the Recipient&apos;s Tax Records (United States)
            </Text>
            <Text style={styles.statementText}>{US_SOURCE_STATEMENT}</Text>
            <Text style={styles.statementText}>{US_SALES_TAX_STATEMENT}</Text>
            {profile.usTaxFormReference ? (
              <Text style={styles.statementText}>
                Withholding certificate on file with the recipient:{" "}
                {profile.usTaxFormReference}.
              </Text>
            ) : null}
            {profile.pan ? (
              <Text style={styles.statementText}>
                Supplier foreign TIN (India PAN): {profile.pan}.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Rule 46(q). The line is left to be signed rather than claiming a
            signature the document does not carry. */}
        <View style={styles.signRow} wrap={false}>
          <View style={styles.signBox}>
            <Text style={styles.signFor}>For {profile.legalName}</Text>
            <View style={styles.signSpace} />
            <View style={styles.signLine} />
            {profile.authorisedSignatory ? (
              <Text style={styles.signName}>{profile.authorisedSignatory}</Text>
            ) : null}
            <Text style={styles.signCaption}>{SIGNATURE_CAPTION}</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {invoice.serialNumber} · Tax invoice under Rule 46, CGST Rules 2017
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>

      {/* Only rendered when a line actually has tasks — an empty annexure
          referred to from the invoice face would be worse than none. */}
      {annexed.length > 0 ? (
        <Page size="A4" style={styles.page}>
          <View style={styles.masthead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.annexTitle}>ANNEXURE A</Text>
              <Text style={styles.annexSubtitle}>Itemised task breakdown</Text>
              <Text style={styles.annexNote}>
                Forms an integral part of tax invoice {invoice.serialNumber} dated{" "}
                {formatDate(invoice.invoiceDate)}. Hours only — the rate and the amount for
                each line are stated on the invoice.
              </Text>
            </View>
            <View>
              <MetaRow label="Invoice No." value={invoice.serialNumber} />
              <MetaRow label="Client" value={invoice.clientSnapshot.name} />
              <MetaRow label="Total Hours" value={formatNumber(totalHours, "en-US")} />
            </View>
          </View>

          <View style={styles.goldRule} />

          {annexed.map((item) => {
            const tasks = item.tasks ?? [];
            return (
              <View key={item.id}>
                <View style={styles.annexSection}>
                  <Text style={styles.annexSectionLabel}>
                    INVOICE LINE {invoice.lineItems.indexOf(item) + 1}
                  </Text>
                  <Text style={styles.annexSectionName}>{item.description}</Text>
                </View>

                <View style={styles.tableHead}>
                  <Text style={[styles.th, styles.colIndex]}>#</Text>
                  <Text style={[styles.th, styles.colTaskDate]}>DATE</Text>
                  <Text style={[styles.th, styles.colTaskDesc]}>TASK PERFORMED</Text>
                  <Text style={[styles.th, styles.colTaskHours]}>HOURS</Text>
                </View>

                {tasks.map((task, taskIndex) => (
                  <View key={task.id} style={styles.tr} wrap={false}>
                    <Text style={styles.colIndex}>{taskIndex + 1}</Text>
                    <Text style={styles.colTaskDate}>{formatDate(task.date)}</Text>
                    <Text style={styles.colTaskDesc}>{task.description}</Text>
                    <Text style={styles.colTaskHours}>
                      {formatNumber(task.hours, "en-US")}
                    </Text>
                  </View>
                ))}

                <View style={styles.annexSubtotal}>
                  <Text style={styles.annexSubtotalLabel}>
                    Hours on invoice line {invoice.lineItems.indexOf(item) + 1}
                  </Text>
                  <Text style={styles.annexSubtotalValue}>
                    {formatNumber(taskHours(tasks), "en-US")}
                  </Text>
                </View>
              </View>
            );
          })}

          <View style={styles.annexTotalRow}>
            <Text style={styles.annexTotalLabel}>Total hours billed</Text>
            <Text style={styles.annexTotalValue}>{formatNumber(totalHours, "en-US")}</Text>
          </View>

          <View style={styles.footer} fixed>
            <Text style={styles.footerText}>
              {invoice.serialNumber} · Annexure A · Itemised task breakdown
            </Text>
            <Text
              style={styles.footerText}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
            />
          </View>
        </Page>
      ) : null}
    </Document>
  );
}

/** Earliest task date on a line — the start of the span the annexure covers. */
function earliestTaskDate(tasks: { date: string }[]): string {
  return tasks.reduce((min, task) => (task.date < min ? task.date : min), tasks[0].date);
}

function latestTaskDate(tasks: { date: string }[]): string {
  return tasks.reduce((max, task) => (task.date > max ? task.date : max), tasks[0].date);
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
      {/* A cleared particular says so in words. The cell is kept rather than
          dropped: a wire block missing its IFSC row reads as though the bank does
          not have one, where a marked row reads as unfinished — which it is.
          Spelled out rather than punctuated because a dash is indistinguishable
          from an empty cell once the page is printed or the text extracted. */}
      <Text style={styles.bankValue}>{value.trim() || "NOT PROVIDED"}</Text>
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
