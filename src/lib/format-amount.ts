const amountFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(value: number) {
  const formatted = amountFormatter.format(Math.abs(value));
  return value < 0 ? `(${formatted})` : formatted;
}
