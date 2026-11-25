/** Convert a non-negative checkout amount to cents like the API's Decimal boundary. */
export function toCheckoutCents(amount: number): number {
  // Shift the decimal exponent before rounding, so 1.275 becomes 127.5,
  // not 127.49999999999999. Line tax deliberately uses its own API rule.
  const [digits, exponent = "0"] = String(amount).split("e");
  return Math.round(Number(`${digits}e${Number(exponent) + 2}`));
}
