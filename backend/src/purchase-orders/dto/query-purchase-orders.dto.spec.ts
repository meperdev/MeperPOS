import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryPurchaseOrdersDto } from './query-purchase-orders.dto';

async function statusErrors(status: string) {
  const dto = plainToInstance(QueryPurchaseOrdersDto, { status });
  const errors = await validate(dto);
  return errors.filter((error) => error.property === 'status');
}

describe('QueryPurchaseOrdersDto status', () => {
  it('accepts OPEN, the filter the daily report links to', async () => {
    expect(await statusErrors('OPEN')).toHaveLength(0);
  });

  it('still accepts a single status', async () => {
    expect(await statusErrors('PARTIAL_RECEIVED')).toHaveLength(0);
  });

  it('still rejects an unknown status', async () => {
    expect(await statusErrors('NOPE')).toHaveLength(1);
  });
});
