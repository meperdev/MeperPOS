import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { OrgRole, PrismaClient, ProductType } from '@prisma/client';
import request, { type Response } from 'supertest';
import { configureApp, configureErrorHandling } from '../app-configuration';
import { AppModule } from '../app.module';

/**
 * T4 — stock transfers between sites, against real PostgreSQL.
 *
 * Every case drives the public HTTP contract of `backend/src/transfers`: a
 * dispatch moves stock out of the source site (and out of the organization
 * aggregate while the document travels), a receipt lands it at the destination,
 * and a cancellation returns it to the origin. The suite also pins the tenant
 * boundary, the site authorization on both ends, the compare-and-swap refusal on
 * an over-draw, and the concurrency contract of two conflicting requests.
 *
 * It is bound to an explicitly provided disposable database and creates only its
 * own uniquely named rows; the guard below refuses anything else. Run it with
 *
 *   TRANSFERS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55440/meperpos_stock_rehearsal_w4_xfer?schema=public \
 *     npx jest --runInBand src/transfers/transfers.http.int.spec.ts
 *
 * T23 extends the contract to the destination's own cashier: that role lists,
 * reads and receives at the sites assigned to it, and still cannot dispatch or
 * cancel. The route guard is the first boundary; the site authorization inside
 * the transaction is the second one.
 */
const databaseUrl = process.env.TRANSFERS_TEST_DATABASE_URL;

interface SiteFixture {
  id: string;
  name: string;
}

(databaseUrl ? describe : describe.skip)(
  'Stock transfers (HTTP integration, real PostgreSQL)',
  () => {
    const label = `t4-${randomUUID()}`;
    const prisma = new PrismaClient();
    let app: INestApplication<Server>;
    let orgId: string;
    let otherOrgId: string;
    let origin: SiteFixture;
    let warehouse: SiteFixture;
    let secondWarehouse: SiteFixture;
    let foreignSite: SiteFixture;
    /** One product per stock-sensitive case, so no case depends on another's balance. */
    const products: Record<string, string> = {};
    let serviceProductId: string;
    let foreignProductId: string;
    let admin: string;
    let owner: string;
    let memberBothSites: string;
    let memberOriginOnly: string;
    let memberNoSites: string;
    let cashier: string;
    let destinationCashier: string;
    let foreignAdmin: string;
    const createdEmails: string[] = [];

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        !url.port ||
        url.port === '5432' ||
        url.search !== '?schema=public' ||
        !/^\/meperpos_stock_rehearsal_w[0-9]+_xfer[a-z0-9_]*$/.test(
          url.pathname,
        )
      ) {
        throw new Error(
          'Expected an explicit disposable T4 PostgreSQL database',
        );
      }
      // The application reads its datasource from the environment at boot; the
      // suite's own client uses the same disposable URL explicitly.
      process.env.DATABASE_URL = url.href;
      process.env.JWT_SECRET =
        process.env.JWT_SECRET ?? 'transfers-spec-secret';

      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleRef.createNestApplication<INestApplication<Server>>({
        logger: false,
      });
      configureApp(app);
      configureErrorHandling(app);
      await app.init();

      const first = await prisma.organization.create({
        data: {
          name: `${label} principal`,
          slug: `${label}-principal`,
          locations: {
            create: [
              { id: randomUUID(), name: 'Sede principal', isDefault: true },
              { id: randomUUID(), name: 'Bodega norte', type: 'WAREHOUSE' },
              { id: randomUUID(), name: 'Bodega sur', type: 'WAREHOUSE' },
            ],
          },
        },
        include: { locations: true },
      });
      const second = await prisma.organization.create({
        data: {
          name: `${label} vecina`,
          slug: `${label}-vecina`,
          locations: {
            create: [
              { id: randomUUID(), name: 'Sede principal', isDefault: true },
              { id: randomUUID(), name: 'Bodega vecina', type: 'WAREHOUSE' },
            ],
          },
        },
        include: { locations: true },
      });
      orgId = first.id;
      otherOrgId = second.id;
      origin = first.locations.find((site) => site.isDefault)!;
      const warehouses = first.locations.filter((site) => !site.isDefault);
      warehouse = warehouses[0];
      secondWarehouse = warehouses[1];
      foreignSite = second.locations.find((site) => !site.isDefault)!;

      const category = await prisma.category.create({
        data: { name: `${label}-cat`, organizationId: orgId },
      });
      const otherCategory = await prisma.category.create({
        data: { name: `${label}-cat`, organizationId: otherOrgId },
      });
      const product = async (
        key: string,
        stock: number,
        extra: { type?: ProductType; tracksStock?: boolean } = {},
      ) => {
        const created = await prisma.product.create({
          data: {
            name: `${label} ${key}`,
            sku: `${label}-${key}`,
            costPrice: 1000,
            salePrice: 2000,
            stock,
            categoryId: category.id,
            organizationId: orgId,
            ...extra,
          },
        });
        products[key] = created.id;
        return created.id;
      };
      await product('dispatch', 10);
      await product('overdraw', 4);
      await product('receive', 5);
      await product('cancel', 3);
      await product('double', 6);
      await product('race', 4);
      await product('authz', 2);
      await product('listing', 8);
      await product('hidden', 3);
      await product('leg', 2);
      await product('cashierReceive', 6);
      await product('cashierOffSite', 4);
      await product('cashierList', 8);
      await product('cashierCancel', 5);
      serviceProductId = await product('service', 0, {
        type: ProductType.SERVICE,
        tracksStock: false,
      });
      foreignProductId = (
        await prisma.product.create({
          data: {
            name: `${label} foreign`,
            sku: `${label}-foreign`,
            costPrice: 1000,
            salePrice: 2000,
            stock: 3,
            categoryId: otherCategory.id,
            organizationId: otherOrgId,
          },
        })
      ).id;

      const member = async (tag: string, role: OrgRole) => {
        const email = `${label}-${tag}@example.test`;
        createdEmails.push(email);
        return prisma.user.create({
          data: {
            name: tag,
            email,
            password: 'not-a-login-credential',
            organizationUsers: {
              create: [{ organizationId: orgId, role }],
            },
          },
        });
      };
      const foreignEmail = `${label}-foreign-admin@example.test`;
      createdEmails.push(foreignEmail);
      const foreign = await prisma.user.create({
        data: {
          name: 'foreign admin',
          email: foreignEmail,
          password: 'not-a-login-credential',
          organizationUsers: {
            create: [{ organizationId: otherOrgId, role: OrgRole.ADMIN }],
          },
        },
      });
      const [adminUser, ownerUser, both, originOnly, bare, cashierUser] =
        await Promise.all([
          member('admin', OrgRole.ADMIN),
          member('owner', OrgRole.ADMIN),
          member('member-both', OrgRole.CASHIER),
          member('member-origin', OrgRole.CASHIER),
          member('member-bare', OrgRole.CASHIER),
          member('cashier', OrgRole.CASHIER),
        ]);
      await prisma.membershipLocation.createMany({
        data: [
          { userId: both.id, organizationId: orgId, locationId: origin.id },
          {
            userId: both.id,
            organizationId: orgId,
            locationId: warehouse.id,
          },
          {
            userId: originOnly.id,
            organizationId: orgId,
            locationId: origin.id,
          },
        ],
        // T3h: the principal site is the baseline grant of every operational
        // membership, so the explicit rows above may already be there.
        skipDuplicates: true,
      });
      // The zero-assignment member keeps meaning "an administrator removed the
      // baseline grant": the membership trigger installed it when the
      // membership was created.
      await prisma.membershipLocation.deleteMany({
        where: { userId: bare.id },
      });

      // T23: a cashier assigned to the destination store is the role that
      // actually receives the goods. The membership trigger already gave it the
      // principal site, so only the destination grant is added here.
      const receivingCashier = await member(
        'cashier-destination',
        OrgRole.CASHIER,
      );
      await prisma.membershipLocation.createMany({
        data: [
          {
            userId: receivingCashier.id,
            organizationId: orgId,
            locationId: warehouse.id,
          },
        ],
        skipDuplicates: true,
      });

      const jwt = app.get(JwtService);
      const sign = (
        user: { id: string; email: string; tokenVersion: number },
        organizationId: string,
        role: OrgRole,
      ) =>
        `Bearer ${jwt.sign({
          sub: user.id,
          email: user.email,
          tokenVersion: user.tokenVersion,
          organizationId,
          role,
        })}`;
      admin = sign(adminUser, orgId, OrgRole.ADMIN);
      owner = sign(ownerUser, orgId, OrgRole.ADMIN);
      memberBothSites = sign(both, orgId, OrgRole.CASHIER);
      memberOriginOnly = sign(originOnly, orgId, OrgRole.CASHIER);
      memberNoSites = sign(bare, orgId, OrgRole.CASHIER);
      cashier = sign(cashierUser, orgId, OrgRole.CASHIER);
      destinationCashier = sign(receivingCashier, orgId, OrgRole.CASHIER);
      foreignAdmin = sign(foreign, otherOrgId, OrgRole.ADMIN);
    });

    afterAll(async () => {
      try {
        if (orgId) {
          await prisma.organization.deleteMany({
            where: { id: { in: [orgId, otherOrgId] } },
          });
        }
        await prisma.user.deleteMany({
          where: { email: { in: createdEmails } },
        });
      } finally {
        await prisma.$disconnect();
        await app?.close();
      }
    });

    type SiteBody = { id: string; name: string; type: string };
    type TransferBody = {
      id: string;
      number: number;
      status: string;
      notes: string | null;
      fromLocation: SiteBody;
      toLocation: SiteBody;
      items: Array<{
        productId: string;
        quantity: number;
        product: { id: string; name: string; sku: string };
      }>;
      createdAt: string;
      receivedAt: string | null;
      cancelReason: string | null;
    };
    const body = (response: Response) => response.body as TransferBody;
    const message = (response: Response) =>
      (response.body as { message: string }).message;

    const dispatch = (auth: string, payload: Record<string, unknown> = {}) =>
      request(app.getHttpServer())
        .post('/api/transfers')
        .set('Authorization', auth)
        .send({
          fromLocationId: origin.id,
          toLocationId: warehouse.id,
          items: [{ productId: products.dispatch, quantity: 3 }],
          ...payload,
        });
    const receive = (auth: string, id: string) =>
      request(app.getHttpServer())
        .post(`/api/transfers/${id}/receive`)
        .set('Authorization', auth);
    const cancel = (auth: string, id: string, reason?: string) =>
      request(app.getHttpServer())
        .post(`/api/transfers/${id}/cancel`)
        .set('Authorization', auth)
        .send(reason === undefined ? {} : { reason });
    const list = (auth: string, query = '') =>
      request(app.getHttpServer())
        .get(`/api/transfers${query}`)
        .set('Authorization', auth);
    const detail = (auth: string, id: string) =>
      request(app.getHttpServer())
        .get(`/api/transfers/${id}`)
        .set('Authorization', auth);

    /** The per-site ledger for one product, at one site. */
    const siteStock = async (siteId: string, productId: string) => {
      const row = await prisma.productStock.findFirst({
        where: { productId, locationId: siteId, organizationId: orgId },
        select: { stock: true },
      });
      return row?.stock ?? 0;
    };
    /** The organization aggregate the triggers keep equal to the site rows. */
    const aggregate = async (productId: string) => {
      const [row, sites] = await Promise.all([
        prisma.product.findUniqueOrThrow({
          where: { id: productId },
          select: { stock: true },
        }),
        prisma.productStock.aggregate({
          where: { productId, organizationId: orgId },
          _sum: { stock: true },
        }),
      ]);
      return { productStock: row.stock, siteSum: sites._sum.stock ?? 0 };
    };
    const movements = (reference: string) =>
      prisma.inventoryMovement.findMany({
        where: { organizationId: orgId, reason: reference },
        orderBy: { createdAt: 'asc' },
      });

    it('dispatches stock out of the source site and out of the aggregate', async () => {
      const transfer = body(
        await dispatch(admin, { notes: 'Traslado a la bodega' }).expect(201),
      );

      expect(transfer.status).toBe('IN_TRANSIT');
      expect(transfer.number).toBe(1);
      expect(transfer.notes).toBe('Traslado a la bodega');
      expect(transfer.fromLocation).toMatchObject({
        id: origin.id,
        name: origin.name,
      });
      expect(transfer.toLocation).toMatchObject({
        id: warehouse.id,
        name: warehouse.name,
      });
      expect(transfer.items).toHaveLength(1);
      expect(transfer.items[0]).toMatchObject({
        productId: products.dispatch,
        quantity: 3,
      });
      expect(transfer.items[0].product.name).toBe(`${label} dispatch`);

      expect(await siteStock(origin.id, products.dispatch)).toBe(7);
      // The stock is in transit: it left its site and the organization total.
      expect(await siteStock(warehouse.id, products.dispatch)).toBe(0);
      expect(await aggregate(products.dispatch)).toEqual({
        productStock: 7,
        siteSum: 7,
      });

      const [movement] = await movements(`TR-${transfer.number}`);
      expect(movement).toMatchObject({
        productId: products.dispatch,
        type: 'TRANSFER_OUT',
        quantity: -3,
        previousStock: 10,
        newStock: 7,
        locationId: origin.id,
      });
    });

    it('numbers transfers consecutively inside each organization only', async () => {
      const second = body(
        await dispatch(admin, {
          items: [{ productId: products.listing, quantity: 1 }],
        }).expect(201),
      );
      expect(second.number).toBe(2);

      const foreignOrigin = await prisma.location.findFirstOrThrow({
        where: { organizationId: otherOrgId, isDefault: true },
      });
      const foreign = body(
        await request(app.getHttpServer())
          .post('/api/transfers')
          .set('Authorization', foreignAdmin)
          .send({
            fromLocationId: foreignOrigin.id,
            toLocationId: foreignSite.id,
            items: [{ productId: foreignProductId, quantity: 1 }],
          })
          .expect(201),
      );
      expect(foreign.number).toBe(1);
    });

    it('refuses a dispatch between the same site', async () => {
      const before = await aggregate(products.overdraw);
      const response = await dispatch(admin, {
        toLocationId: origin.id,
        items: [{ productId: products.overdraw, quantity: 1 }],
      }).expect(400);
      expect(message(response)).toBe(
        'La sede de origen y la de destino deben ser diferentes',
      );
      expect(await aggregate(products.overdraw)).toEqual(before);
    });

    it('refuses a destination of another tenant without writing anything', async () => {
      const [transfers, movementCount] = await Promise.all([
        prisma.stockTransfer.count({ where: { organizationId: orgId } }),
        prisma.inventoryMovement.count({ where: { organizationId: orgId } }),
      ]);
      const response = await dispatch(admin, {
        toLocationId: foreignSite.id,
      }).expect(404);
      expect(message(response)).toBe('Sede de destino no encontrada');
      expect(
        await prisma.stockTransfer.count({ where: { organizationId: orgId } }),
      ).toBe(transfers);
      expect(
        await prisma.inventoryMovement.count({
          where: { organizationId: orgId },
        }),
      ).toBe(movementCount);
    });

    it('refuses an over-draw and leaves every row and counter unchanged', async () => {
      const item = [{ productId: products.overdraw, quantity: 999 }];
      const [stockBefore, aggregateBefore, transfersBefore, movementsBefore] =
        await Promise.all([
          siteStock(origin.id, products.overdraw),
          aggregate(products.overdraw),
          prisma.stockTransfer.count({ where: { organizationId: orgId } }),
          prisma.inventoryMovement.count({ where: { organizationId: orgId } }),
        ]);

      const response = await dispatch(admin, { items: item }).expect(409);
      expect(message(response)).toContain('Existencias insuficientes');

      expect(await siteStock(origin.id, products.overdraw)).toBe(stockBefore);
      expect(await aggregate(products.overdraw)).toEqual(aggregateBefore);
      expect(
        await prisma.stockTransfer.count({ where: { organizationId: orgId } }),
      ).toBe(transfersBefore);
      expect(
        await prisma.inventoryMovement.count({
          where: { organizationId: orgId },
        }),
      ).toBe(movementsBefore);
    });

    it('refuses untracked products and repeated lines', async () => {
      const untracked = await dispatch(admin, {
        items: [{ productId: serviceProductId, quantity: 1 }],
      }).expect(400);
      expect(message(untracked)).toBe(
        'Solo se pueden transferir productos que manejan inventario',
      );

      const repeated = await dispatch(admin, {
        items: [
          { productId: products.authz, quantity: 1 },
          { productId: products.authz, quantity: 1 },
        ],
      }).expect(400);
      expect(message(repeated)).toContain('está repetido en la transferencia');
    });

    it('bounds the free text of a dispatch', async () => {
      await dispatch(admin, { notes: 'x'.repeat(501) }).expect(400);
    });

    it('refuses a dispatch the caller cannot perform at the source site', async () => {
      const unauthorized = await dispatch(memberOriginOnly, {
        fromLocationId: warehouse.id,
        toLocationId: origin.id,
        items: [{ productId: products.authz, quantity: 1 }],
      }).expect(404);
      expect(message(unauthorized)).toBe('Location not found');

      await dispatch(cashier).expect(403);
      await dispatch(foreignAdmin).expect(404);
      expect(await siteStock(origin.id, products.authz)).toBe(2);
    });

    it('receives an in-transit transfer at the destination and restores the aggregate', async () => {
      const transfer = body(
        await dispatch(admin, {
          items: [{ productId: products.receive, quantity: 3 }],
        }).expect(201),
      );
      expect(await siteStock(origin.id, products.receive)).toBe(2);
      expect(await siteStock(warehouse.id, products.receive)).toBe(0);

      const received = body(
        await receive(memberBothSites, transfer.id).expect(201),
      );
      expect(received.status).toBe('RECEIVED');
      expect(received.receivedAt).not.toBeNull();
      expect(received.id).toBe(transfer.id);

      expect(await siteStock(origin.id, products.receive)).toBe(2);
      expect(await siteStock(warehouse.id, products.receive)).toBe(3);
      expect(await aggregate(products.receive)).toEqual({
        productStock: 5,
        siteSum: 5,
      });

      const inbound = (await movements(`TR-${transfer.number}`)).filter(
        (movement) => movement.type === 'TRANSFER_IN',
      );
      expect(inbound).toHaveLength(1);
      expect(inbound[0]).toMatchObject({
        quantity: 3,
        locationId: warehouse.id,
        previousStock: 2,
        newStock: 5,
      });

      // A received transfer is terminal for both remaining transitions.
      await receive(admin, transfer.id).expect(409);
      await cancel(admin, transfer.id, 'tarde').expect(409);
    });

    it('requires authorization at the destination to receive', async () => {
      const transfer = body(
        await dispatch(admin, {
          items: [{ productId: products.hidden, quantity: 2 }],
        }).expect(201),
      );

      const unauthorized = await receive(memberOriginOnly, transfer.id).expect(
        404,
      );
      expect(message(unauthorized)).toBe('Location not found');
      await receive(foreignAdmin, transfer.id).expect(404);
      // A cashier holds the role, but its assignment is the origin: the
      // destination is as unreachable for it as for any other outsider.
      const offSite = await receive(cashier, transfer.id).expect(404);
      expect(message(offSite)).toBe('Location not found');
      // A caller that reaches neither end cannot cancel it either.
      await cancel(memberNoSites, transfer.id, 'no es mi sede').expect(404);

      expect(await siteStock(origin.id, products.hidden)).toBe(1);
      expect(await siteStock(warehouse.id, products.hidden)).toBe(0);
      const stored = await prisma.stockTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
      });
      expect(stored.status).toBe('IN_TRANSIT');
    });

    it('lets the destination cashier receive at its assigned site', async () => {
      const transfer = body(
        await dispatch(admin, {
          items: [{ productId: products.cashierReceive, quantity: 2 }],
        }).expect(201),
      );
      expect(await siteStock(origin.id, products.cashierReceive)).toBe(4);
      expect(await siteStock(warehouse.id, products.cashierReceive)).toBe(0);

      const received = body(
        await receive(destinationCashier, transfer.id).expect(201),
      );
      expect(received.status).toBe('RECEIVED');
      expect(received.receivedAt).not.toBeNull();

      expect(await siteStock(origin.id, products.cashierReceive)).toBe(4);
      expect(await siteStock(warehouse.id, products.cashierReceive)).toBe(2);
      expect(await aggregate(products.cashierReceive)).toEqual({
        productStock: 6,
        siteSum: 6,
      });

      const inbound = (await movements(`TR-${transfer.number}`)).filter(
        (movement) => movement.type === 'TRANSFER_IN',
      );
      expect(inbound).toHaveLength(1);
      expect(inbound[0]).toMatchObject({
        quantity: 2,
        locationId: warehouse.id,
      });
    });

    it('leaves an off-site cashier without the destination and the transfer in transit', async () => {
      const transfer = body(
        await dispatch(admin, {
          items: [{ productId: products.cashierOffSite, quantity: 2 }],
        }).expect(201),
      );
      const [stockBefore, transfersBefore, movementsBefore] = await Promise.all(
        [
          siteStock(warehouse.id, products.cashierOffSite),
          prisma.stockTransfer.count({ where: { organizationId: orgId } }),
          prisma.inventoryMovement.count({ where: { organizationId: orgId } }),
        ],
      );

      const refused = await receive(cashier, transfer.id).expect(404);
      expect(message(refused)).toBe('Location not found');

      expect(await siteStock(origin.id, products.cashierOffSite)).toBe(2);
      expect(await siteStock(warehouse.id, products.cashierOffSite)).toBe(
        stockBefore,
      );
      expect(await aggregate(products.cashierOffSite)).toEqual({
        productStock: 2,
        siteSum: 2,
      });
      expect(
        await prisma.stockTransfer.count({ where: { organizationId: orgId } }),
      ).toBe(transfersBefore);
      expect(
        await prisma.inventoryMovement.count({
          where: { organizationId: orgId },
        }),
      ).toBe(movementsBefore);
      expect(
        await prisma.stockTransfer.findUniqueOrThrow({
          where: { id: transfer.id },
        }),
      ).toMatchObject({ status: 'IN_TRANSIT' });
    });

    it('refuses dispatch and cancellation for a cashier at either end', async () => {
      const transfer = body(
        await dispatch(admin, {
          items: [{ productId: products.cashierCancel, quantity: 1 }],
        }).expect(201),
      );
      const [transfersBefore, movementsBefore] = await Promise.all([
        prisma.stockTransfer.count({ where: { organizationId: orgId } }),
        prisma.inventoryMovement.count({ where: { organizationId: orgId } }),
      ]);

      await dispatch(cashier).expect(403);
      await dispatch(destinationCashier).expect(403);
      await cancel(cashier, transfer.id, 'desde el origen').expect(403);
      await cancel(destinationCashier, transfer.id, 'desde el destino').expect(
        403,
      );

      expect(await siteStock(origin.id, products.cashierCancel)).toBe(4);
      expect(await siteStock(warehouse.id, products.cashierCancel)).toBe(0);
      expect(
        await prisma.stockTransfer.count({ where: { organizationId: orgId } }),
      ).toBe(transfersBefore);
      expect(
        await prisma.inventoryMovement.count({
          where: { organizationId: orgId },
        }),
      ).toBe(movementsBefore);
      expect(
        await prisma.stockTransfer.findUniqueOrThrow({
          where: { id: transfer.id },
        }),
      ).toMatchObject({ status: 'IN_TRANSIT' });
    });

    it('lists and reads only the transfers touching a cashier site', async () => {
      const seeded = body(
        await dispatch(admin, {
          items: [{ productId: products.cashierList, quantity: 3 }],
        }).expect(201),
      );
      await receive(admin, seeded.id).expect(201);
      const internal = body(
        await dispatch(admin, {
          fromLocationId: warehouse.id,
          toLocationId: secondWarehouse.id,
          items: [{ productId: products.cashierList, quantity: 1 }],
        }).expect(201),
      );

      const listing = await list(cashier).expect(200);
      const visible = (listing.body as { data: TransferBody[] }).data;
      expect(visible.length).toBeGreaterThan(0);
      for (const transfer of visible) {
        expect(
          transfer.fromLocation.id === origin.id ||
            transfer.toLocation.id === origin.id,
        ).toBe(true);
      }
      expect(visible.map((transfer) => transfer.id)).not.toContain(internal.id);
      expect(visible.map((transfer) => transfer.id)).toContain(seeded.id);

      // The destination cashier reads the document that lands at its site.
      const arriving = body(
        await dispatch(admin, {
          items: [{ productId: products.cashierList, quantity: 1 }],
        }).expect(201),
      );
      const arrivingRead = await detail(destinationCashier, arriving.id).expect(
        200,
      );
      expect(body(arrivingRead).toLocation.id).toBe(warehouse.id);
      await detail(destinationCashier, internal.id).expect(200);
      // A document between two sites it cannot reach stays hidden.
      const elsewhere = body(
        await dispatch(admin, {
          fromLocationId: warehouse.id,
          toLocationId: secondWarehouse.id,
          items: [{ productId: products.cashierList, quantity: 1 }],
        }).expect(201),
      );
      await detail(cashier, elsewhere.id).expect(404);
    });

    it('cancels an in-transit transfer back into its origin and requires a reason', async () => {
      const transfer = body(
        await dispatch(admin, {
          items: [{ productId: products.cancel, quantity: 3 }],
        }).expect(201),
      );
      expect(await siteStock(origin.id, products.cancel)).toBe(0);

      const withoutReason = await cancel(admin, transfer.id).expect(400);
      expect(message(withoutReason)).toContain('reason');

      const cancelled = body(
        await cancel(owner, transfer.id, 'La bodega no la recibe').expect(201),
      );
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelReason).toBe('La bodega no la recibe');

      expect(await siteStock(origin.id, products.cancel)).toBe(3);
      expect(await siteStock(warehouse.id, products.cancel)).toBe(0);
      expect(await aggregate(products.cancel)).toEqual({
        productStock: 3,
        siteSum: 3,
      });

      const returning = (await movements(`TR-${transfer.number}`)).filter(
        (movement) => movement.type === 'TRANSFER_IN',
      );
      expect(returning).toHaveLength(1);
      expect(returning[0]).toMatchObject({
        quantity: 3,
        locationId: origin.id,
      });

      await receive(admin, transfer.id).expect(409);
      await cancel(admin, transfer.id, 'otra vez').expect(409);
    });

    it('settles a double receipt and a receive-versus-cancel race with one winner', async () => {
      const doubled = body(
        await dispatch(admin, {
          items: [{ productId: products.double, quantity: 3 }],
        }).expect(201),
      );
      const [first, second] = await Promise.all([
        receive(admin, doubled.id),
        receive(admin, doubled.id),
      ]);
      expect([first.status, second.status].sort()).toEqual([201, 409]);
      expect(await siteStock(warehouse.id, products.double)).toBe(3);
      expect(await aggregate(products.double)).toEqual({
        productStock: 6,
        siteSum: 6,
      });

      const contested = body(
        await dispatch(admin, {
          items: [{ productId: products.race, quantity: 2 }],
        }).expect(201),
      );
      const [receipt, cancellation] = await Promise.all([
        receive(admin, contested.id),
        cancel(admin, contested.id, 'La bodega la rechaza'),
      ]);
      expect([receipt.status, cancellation.status].sort()).toEqual([201, 409]);

      const settled = await prisma.stockTransfer.findUniqueOrThrow({
        where: { id: contested.id },
      });
      expect(['RECEIVED', 'CANCELLED']).toContain(settled.status);
      // Exactly one leg was applied: either the destination holds the stock or
      // the origin kept it after the cancellation won.
      const received = settled.status === 'RECEIVED';
      expect(await siteStock(warehouse.id, products.race)).toBe(
        received ? 2 : 0,
      );
      expect(await siteStock(origin.id, products.race)).toBe(received ? 2 : 4);
      expect(await aggregate(products.race)).toEqual({
        productStock: 4,
        siteSum: 4,
      });
    });

    it('lists and reads only the transfers of the caller and its sites', async () => {
      const listing = await list(admin).expect(200);
      const page = listing.body as {
        data: TransferBody[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
      expect(page.data.length).toBeGreaterThan(0);
      expect(page.meta).toMatchObject({ page: 1, limit: 10 });
      expect(page.meta.total).toBeGreaterThanOrEqual(page.data.length);
      expect(page.data[0].items.length).toBeGreaterThan(0);

      // The list paginates like every other collection: page size and pages.
      const firstPage = await list(admin, '?limit=2').expect(200);
      const firstPageBody = firstPage.body as {
        data: TransferBody[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
      expect(firstPageBody.data).toHaveLength(2);
      expect(firstPageBody.meta).toMatchObject({ page: 1, limit: 2 });
      expect(firstPageBody.meta.totalPages).toBe(
        Math.ceil(firstPageBody.meta.total / 2),
      );
      const later = await list(admin, '?limit=2&page=2').expect(200);
      expect((later.body as { meta: { page: number } }).meta.page).toBe(2);
      expect((later.body as { data: TransferBody[] }).data[0].id).not.toBe(
        firstPageBody.data[0].id,
      );

      const restricted = await list(memberOriginOnly).expect(200);
      const visible = (restricted.body as { data: TransferBody[] }).data;
      expect(visible.length).toBeGreaterThan(0);
      for (const transfer of visible) {
        expect(
          transfer.fromLocation.id === origin.id ||
            transfer.toLocation.id === origin.id,
        ).toBe(true);
      }

      const bare = await list(memberNoSites).expect(200);
      expect((bare.body as { data: TransferBody[] }).data).toEqual([]);

      const bySite = await list(admin, `?siteId=${warehouse.id}`).expect(200);
      for (const transfer of (bySite.body as { data: TransferBody[] }).data) {
        expect(
          transfer.fromLocation.id === warehouse.id ||
            transfer.toLocation.id === warehouse.id,
        ).toBe(true);
      }

      const inTransit = await list(admin, '?status=IN_TRANSIT').expect(200);
      for (const transfer of (inTransit.body as { data: TransferBody[] })
        .data) {
        expect(transfer.status).toBe('IN_TRANSIT');
      }

      // Another tenant sees its own documents only.
      const foreignPage = await list(foreignAdmin).expect(200);
      const foreignRows = (foreignPage.body as { data: TransferBody[] }).data;
      expect(foreignRows.length).toBeGreaterThan(0);
      for (const transfer of foreignRows) {
        expect(
          transfer.fromLocation.id === foreignSite.id ||
            transfer.toLocation.id === foreignSite.id,
        ).toBe(true);
      }

      // A transfer between two sites this caller cannot reach stays hidden. The
      // stock first travels into the warehouse through the same API.
      const seeded = body(
        await dispatch(admin, {
          items: [{ productId: products.leg, quantity: 2 }],
        }).expect(201),
      );
      await receive(admin, seeded.id).expect(201);
      const internal = body(
        await dispatch(admin, {
          fromLocationId: warehouse.id,
          toLocationId: secondWarehouse.id,
          items: [{ productId: products.leg, quantity: 1 }],
        }).expect(201),
      );
      await detail(memberOriginOnly, internal.id).expect(404);
      const afterInternal = await list(memberOriginOnly).expect(200);
      expect(
        (afterInternal.body as { data: TransferBody[] }).data.map(
          (transfer) => transfer.id,
        ),
      ).not.toContain(internal.id);

      const read = body(await detail(admin, internal.id).expect(200));
      expect(read.items[0].product.name).toBe(`${label} leg`);
      expect(read.fromLocation.name).toBe(warehouse.name);
      expect(read.toLocation.name).toBe(secondWarehouse.name);

      await detail(foreignAdmin, internal.id).expect(404);
      // CASHIER holds the route now, but reaches only its assigned sites.
      await detail(cashier, internal.id).expect(404);
    });

    it('keeps the organization aggregate equal to the sum of its site rows', async () => {
      for (const productId of Object.values(products)) {
        const { productStock, siteSum } = await aggregate(productId);
        expect(productStock).toBe(siteSum);
      }
    });

    it('preserves the tenant boundary of the document identifier', async () => {
      const foreignOrigin = await prisma.location.findFirstOrThrow({
        where: { organizationId: otherOrgId, isDefault: true },
      });
      const transfer = await prisma.stockTransfer.create({
        data: {
          number: 9000,
          organizationId: otherOrgId,
          fromLocationId: foreignSite.id,
          toLocationId: foreignOrigin.id,
        },
      });

      await detail(admin, transfer.id).expect(404);
      await receive(admin, transfer.id).expect(404);
      await cancel(admin, transfer.id, 'ajena').expect(404);
      expect(
        await prisma.stockTransfer.findUniqueOrThrow({
          where: { id: transfer.id },
        }),
      ).toMatchObject({ status: 'IN_TRANSIT' });
    });
  },
);
