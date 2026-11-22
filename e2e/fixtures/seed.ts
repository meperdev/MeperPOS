/**
 * The data backend/prisma/seed-e2e.ts writes into the smoke database.
 * Keep the two in sync: the specs assert on these exact values.
 */
export const SEED = {
  owner: {
    email: "owner@smoke-e2e.test",
    password: "smoke-e2e-owner",
    firstName: "Dueña",
  },
  category: "Bebidas E2E",
  coffee: {
    name: "Café americano E2E",
    sku: "E2E-CAFE-001",
    /** Untaxed, so the charged total equals the sale price. */
    salePrice: 5000,
  },
} as const;

/**
 * COP as the app prints it (`formatCurrency`): no decimals, dot thousands,
 * and a non-breaking space after the sign, which a plain-space string would
 * not match.
 */
export function cop(amount: number): RegExp {
  const digits = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return new RegExp(`\\$\\s?${digits.replace(/\./g, "\\.")}(?!\\d)`);
}
