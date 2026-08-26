# REQUIREMENTS.md

# Project Overview: VrikshaFX — Forex & HUF Bookkeeping System

- **Entity Name:** Rahul Goel HUF
- **Target Platform:** Web Application (Responsive Desktop & Mobile UI)
- **Primary Base Currency:** INR
- **Secondary Foreign Currencies:** USD, EUR (Expandable to GBP, SGD, AED)

---

# Core Requirements

### 1. Invoicing Module
- **Custom Serial Numbering:** Generate invoices with customizable, auto-incrementing serial structures (e.g., `RGHUF/INV/26-27/001`).
- **Foreign Client Support:** Issue invoices in USD, EUR, or other configured secondary foreign currencies.
- **Client-side PDF Generation:** Download downloadable A4 Tax Invoices with one click, fully styled for print.
- **IGST & Tax Disclaimers (Export of Services):**
  - **IGST Rate:** Fixed 0% (Zero-rated export under LUT / Section 16 of IGST Act).
  - **Mandatory Legal Disclaimer:**
    > *"SUPPLY MEANT FOR EXPORT OF SERVICES UNDER LETTER OF UNDERTAKING (LUT) WITHOUT PAYMENT OF INTEGRATED TAX (IGST). REMITTANCE TO BE CREDITED IN FOREIGN CURRENCY TO RAHUL GOEL HUF BANK ACCOUNT."*
  - **Banking & Wire Instructions:** Explicit display of HUF Bank Name, Account Number, IFSC Code, and SWIFT/BIC Code for international wire transfers.

### 2. Google Drive Storage Integration
- **Automated Document Sync:** Save generated PDF invoices and metadata directly to Google Drive.
- **Folder Structure:** Organized storage pathing under `Google Drive/Rahul Goel HUF/Invoices/FY26-27/`.

### 3. Forex & Remittance Realization Module
- **Invoice Date FX Logging:** Record Invoice Date, Amount in Foreign Currency (FCY), and the prevailing exchange rate on the Invoice Date.
- **Remittance Realization Entry:** Log Receipt Date, Receipt Time, Actual FCY received, Net INR credited to the bank, and Bank Forex Charges/SWIFT Fees in INR.
- **Auto-Calculated Realized Forex Variance:**
  $$\text{Realized Forex Gain/Loss} = \text{INR Credited} - (\text{FCY Received} \times \text{Invoice Date FX Rate}) - \text{Bank Charges}$$
- **FIRC / SWIFT Tracking:** Field to record Foreign Inward Remittance Certificate (FIRC) reference details per received payment.

### 4. Ledger & Financial Reports
- **Pending Receivables:** Real-time view of outstanding foreign invoices (in FCY and base INR).
- **Realized Forex Summary:** Total realized forex gains/losses aggregated by financial year.
- **HUF Profit & Loss (P&L) Statement:** Standardized P&L report for HUF income tax filing, showing total foreign income realized, bank charges, and realized FX gains.

---

# Inspired Zoho Books Features (Streamlined)

To ensure a professional accounting experience without unnecessary bloat, the application adopts these essential UX patterns from mature platforms:

### 1. Client & Contact Directory
- Store client profile details: Billing Address, Country, Default Currency, Tax Identification Number, and Primary Contact.

### 2. Accounts Receivable (AR) Aging Dashboard
- Categorize outstanding invoices into clean aging buckets: **0–30 Days**, **31–60 Days**, **61–90 Days**, and **90+ Days Overdue** to monitor cash flow.

### 3. Chart of Accounts & Simple Expense Ledger
- Simple categories for HUF expenses (Bank Charges, Software Subscriptions, Filing Fees) to allow complete net income calculation.

### 4. Audit Trail & Activity Log
- Immutable logs tracking invoice creation, payment entries, PDF downloads, and manual overrides for tax compliance assurance.

---

# UI & UX Design System

- **Design Tone:** Clean, minimalist enterprise interface inspired by Zoho Books and Stripe.
- **Desktop Navigation:** Collapsible left sidebar, quick metric summary cards, filterable data tables, and quick drawer panels (`Sheet` views) for fast invoice creation.
- **Mobile Responsive:** Thumb-friendly bottom action navigation, swipeable summary cards, and mobile-optimized forms.
- **Color Palette:** Professional Slate/Navy theme with clear visual indicators for invoice statuses (*Draft*, *Sent*, *Paid*, *Overdue*)   