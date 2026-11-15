import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { CustomerPlateInterceptor } from './customer-plate.interceptor';

describe('CustomerPlateInterceptor', () => {
  const modules = { isEnabled: jest.fn() };
  const interceptor = new CustomerPlateInterceptor(modules as never);
  const context = (body: unknown = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { organizationId: 'org-1' }, body }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('hides legacy plates from customer results when the module is disabled', async () => {
    modules.isEnabled.mockResolvedValue(false);
    const result = await firstValueFrom(
      interceptor.intercept(context(), {
        handle: () => of({ data: [{ name: 'A', placaMoto: 'ABC123' }] }),
      }),
    );
    expect(result).toEqual({ data: [{ name: 'A', placaMoto: null }] });
  });

  it('rejects plate writes when the module is disabled', async () => {
    modules.isEnabled.mockResolvedValue(false);
    const handler = { handle: jest.fn(() => of({})) };
    await expect(
      firstValueFrom(
        interceptor.intercept(context({ placaMoto: 'ABC123' }), handler),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('preserves legacy customer behavior when the module is enabled', async () => {
    modules.isEnabled.mockResolvedValue(true);
    const result = await firstValueFrom(
      interceptor.intercept(context({ placaMoto: 'ABC123' }), {
        handle: () => of({ placaMoto: 'ABC123' }),
      }),
    );
    expect(result).toEqual({ placaMoto: 'ABC123' });
  });
});
