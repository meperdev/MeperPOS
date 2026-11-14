import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { OrganizationStatusGuard } from './organization-status.guard';

describe('OrganizationStatusGuard', () => {
  let guard: OrganizationStatusGuard;

  const createMockContext = (options?: {
    method?: string;
    orgStatus?: string;
    isSuperAdmin?: boolean;
    role?: string;
  }): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method: options?.method ?? 'GET',
          user: {
            orgStatus: options?.orgStatus,
            isSuperAdmin: options?.isSuperAdmin ?? false,
            role: options?.role ?? 'ADMIN',
          },
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    guard = new OrganizationStatusGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('allows GET for SUSPENDED organization', async () => {
    const context = createMockContext({
      method: 'GET',
      orgStatus: 'SUSPENDED',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows HEAD for SUSPENDED organization', async () => {
    const context = createMockContext({
      method: 'HEAD',
      orgStatus: 'SUSPENDED',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('blocks POST for SUSPENDED organization (403)', async () => {
    const context = createMockContext({
      method: 'POST',
      orgStatus: 'SUSPENDED',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException({
        message: 'Organization is suspended. Write operations are disabled.',
        status: 'SUSPENDED',
      }),
    );
  });

  it('blocks PUT for SUSPENDED organization (403)', async () => {
    const context = createMockContext({
      method: 'PUT',
      orgStatus: 'SUSPENDED',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks PATCH for SUSPENDED organization (403)', async () => {
    const context = createMockContext({
      method: 'PATCH',
      orgStatus: 'SUSPENDED',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks DELETE for SUSPENDED organization (403)', async () => {
    const context = createMockContext({
      method: 'DELETE',
      orgStatus: 'SUSPENDED',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows all methods for ACTIVE organization', async () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    for (const method of methods) {
      const context = createMockContext({
        method,
        orgStatus: 'ACTIVE',
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
  });

  it('allows all methods for TRIAL organization', async () => {
    const context = createMockContext({
      method: 'POST',
      orgStatus: 'TRIAL',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('blocks writes for PAST_DUE organization but keeps reads available', async () => {
    const writeError = await guard
      .canActivate(createMockContext({ method: 'POST', orgStatus: 'PAST_DUE' }))
      .catch((error: unknown) => error);

    expect(writeError).toBeInstanceOf(ForbiddenException);
    expect(
      (writeError as ForbiddenException).getResponse(),
    ).toMatchObject({
      status: 'PAST_DUE',
      message:
        'Organization is past due. Write operations are disabled until the payment is settled.',
    });

    await expect(
      guard.canActivate(createMockContext({ method: 'GET', orgStatus: 'PAST_DUE' })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(createMockContext({ method: 'HEAD', orgStatus: 'PAST_DUE' })),
    ).resolves.toBe(true);
  });

  it('blocks every non-read method for PAST_DUE organization', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await expect(
        guard.canActivate(createMockContext({ method, orgStatus: 'PAST_DUE' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('allows SuperAdmin bypass regardless of status', async () => {
    const context = createMockContext({
      method: 'POST',
      orgStatus: 'SUSPENDED',
      isSuperAdmin: true,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows SuperAdmin bypass with SUPER_ADMIN role', async () => {
    const context = createMockContext({
      method: 'POST',
      orgStatus: 'SUSPENDED',
      role: 'SUPER_ADMIN',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows requests without orgStatus', async () => {
    const context = createMockContext({
      method: 'POST',
      orgStatus: undefined,
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
