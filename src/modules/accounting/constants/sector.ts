export const CREDIT_VOUCHER_SECTOR_CODES = ["GS", "CC", "EQ", "MS"] as const;

export type CreditVoucherSector = (typeof CREDIT_VOUCHER_SECTOR_CODES)[number];

export const CREDIT_VOUCHER_SECTOR_LABELS: Record<CreditVoucherSector, string> = {
  GS: "Guard Service",
  CC: "Cash Carrying",
  EQ: "Equipment",
  MS: "Miscellaneous",
};
