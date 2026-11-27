import { UserHandler } from './user.handler';
import type { ParsedFileRow, SheetRowContext } from '../import-sheet-handler.interface';

describe('UserHandler', () => {
  let usersService: { create: jest.Mock };
  let handler: UserHandler;

  beforeEach(() => {
    usersService = { create: jest.fn().mockResolvedValue(undefined) };
    handler = new UserHandler(usersService as never);
  });

  function makeCtx(overrides: Partial<SheetRowContext> = {}): SheetRowContext {
    return {
      organizationId: 'org-1',
      userId: 'user-1',
      prisma: {},
      planLimits: {},
      existingKeys: new Set<string>(),
      ...overrides,
    } as unknown as SheetRowContext;
  }

  function makeRow(rawData: Record<string, string>, rowIndex = 2): ParsedFileRow {
    return { rowIndex, rawData };
  }

  describe('validateRow', () => {
    it('validates a mapped user row and defaults the role to CASHIER', () => {
      const ctx = makeCtx();

      const result = handler.validateRow(
        makeRow({
          'Correo': 'user@example.com',
          'Password': 'correct-horse-battery-staple',
          'Nombre': 'John Doe',
        }),
        ctx,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toMatchObject({
          email: 'user@example.com',
          password: 'correct-horse-battery-staple',
          name: 'John Doe',
          role: 'CASHIER',
        });
      }
      expect(ctx.existingKeys.has('user@example.com')).toBe(true);
    });

    it('rejects an email already registered (pre-seeded existing key)', () => {
      const ctx = makeCtx({ existingKeys: new Set(['user@example.com']) });

      const result = handler.validateRow(
        makeRow({
          'Correo': 'user@example.com',
          'Password': 'correct-horse-battery-staple',
          'Nombre': 'John Doe',
        }),
        ctx,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.errorCode).toBe('DUPLICATE_EMAIL');
        expect(result.error.field).toBe('email');
      }
    });

    it('rejects a duplicate email within the same file', () => {
      const ctx = makeCtx();
      handler.validateRow(
        makeRow({ 'Correo': 'dup@example.com', 'Password': 'correct-horse-battery-staple', 'Nombre': 'A' }, 2),
        ctx,
      );

      const duplicate = handler.validateRow(
        makeRow({ 'Correo': 'dup@example.com', 'Password': 'correct-horse-battery-staple', 'Nombre': 'B' }, 3),
        ctx,
      );

      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.error.errorCode).toBe('DUPLICATE_EMAIL');
      }
    });

    it('propagates a weak-password rejection via the shared policy', () => {
      const ctx = makeCtx();

      const result = handler.validateRow(
        makeRow({ 'Correo': 'user@example.com', 'Password': 'short', 'Nombre': 'John Doe' }),
        ctx,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.errorCode).toBe('INVALID_PASSWORD');
        expect(result.error.field).toBe('password');
      }
    });
  });

  describe('createRow', () => {
    it('creates the user via the service with the organization id', async () => {
      const ctx = makeCtx();

      await handler.createRow(
        { email: 'user@example.com', password: 'correct-horse-battery-staple', name: 'John Doe', role: 'CASHIER' },
        ctx,
      );

      expect(usersService.create).toHaveBeenCalledTimes(1);
      const [dto, organizationId] = usersService.create.mock.calls[0];
      expect(dto).toMatchObject({
        email: 'user@example.com',
        password: 'correct-horse-battery-staple',
        name: 'John Doe',
        role: 'CASHIER',
      });
      expect(organizationId).toBe('org-1');
    });

    it('passes the importing actor so the primary-owner rule for ADMIN rows applies', async () => {
      const ctx = { ...makeCtx(), actorRole: 'ADMIN' as const };

      await handler.createRow(
        { email: 'a@example.com', password: 'correct-horse-battery-staple', name: 'A', role: 'ADMIN' },
        ctx,
      );

      const [, , actor] = usersService.create.mock.calls[0];
      expect(actor).toEqual({
        userId: ctx.userId,
        role: 'ADMIN',
        isSuperAdmin: false,
      });
    });

    it('marks a SUPER_ADMIN importer as such', async () => {
      const ctx = { ...makeCtx(), actorRole: 'SUPER_ADMIN' as const };

      await handler.createRow(
        { email: 'b@example.com', password: 'correct-horse-battery-staple', name: 'B', role: 'ADMIN' },
        ctx,
      );

      const [, , actor] = usersService.create.mock.calls[0];
      expect(actor).toMatchObject({ role: 'SUPER_ADMIN', isSuperAdmin: true });
    });
  });

  describe('contract metadata', () => {
    it('declares the usuarios sheet id, required and editable fields', () => {
      expect(handler.sheetId).toBe('usuarios');
      expect(handler.requiredFields).toEqual(['email', 'password']);
      expect(handler.editableFields).toEqual(['email', 'password', 'name', 'role']);
    });
  });
});
