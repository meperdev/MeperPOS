/**
 * The seed values the explorer needs, mirrored from fixtures/seed.ts (which
 * mirrors backend/prisma/seed-e2e.ts). `npm run test:scripts` fails if they
 * drift apart.
 */
export const EXPLORE_SEED = {
  owner: {
    email: "owner@smoke-e2e.test",
    password: "smoke-e2e-owner",
  },
  category: "Bebidas E2E",
  coffee: {
    name: "Café americano E2E",
    sku: "E2E-CAFE-001",
    salePrice: 5000,
    stock: 1000,
  },
};
