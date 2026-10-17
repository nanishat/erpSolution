export const dashboardNavItem = {
  label: "Dashboard",
  href: "/accounting",
} as const;

export type NavItem = { label: string; href: string };
export type NavGroup = { label: string; items: readonly NavItem[] };

export const navGroups: readonly NavGroup[] = [
  {
    label: "Sales",
    items: [{ label: "Customer Invoices", href: "/accounting/invoices" }],
  },
  {
    label: "Purchases",
    items: [{ label: "Vendor Bills", href: "/accounting/vendor-bills" }],
  },
  {
    label: "Vouchers",
    items: [
      { label: "All Vouchers", href: "/accounting/journal-entries" },
      { label: "New Voucher", href: "/accounting/journal-entries/new" },
    ],
  },
  {
    label: "Banking",
    items: [
      { label: "Record Payment", href: "/accounting/payments/new" },
      { label: "Bank Reconciliation", href: "/accounting/bank-reconciliation" },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Trial Balance", href: "/accounting/reports/trial-balance" },
      { label: "General Ledger", href: "/accounting/reports/general-ledger" },
      { label: "Profit & Loss", href: "/accounting/reports/profit-loss" },
      { label: "Balance Sheet", href: "/accounting/reports/balance-sheet" },
      { label: "Cash Flow", href: "/accounting/reports/cash-flow" },
      { label: "VAT / TDS / VDS", href: "/accounting/reports/vat" },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Chart of Accounts", href: "/accounting/chart-of-accounts" },
      { label: "Partners", href: "/accounting/partners" },
      { label: "Products & Services", href: "/accounting/product-services" },
      { label: "Tax Rates", href: "/accounting/tax-rates" },
    ],
  },
];
