import { SequenceService } from './sequence.service';

function makeTx(options: {
  currentNumber: number;
  maxSale?: number;
  maxPo?: number;
  prefix?: string | null;
  rows?: boolean;
}) {
  const {
    currentNumber,
    maxSale = 0,
    maxPo = 0,
    prefix = null,
    rows = true,
  } = options;
  return {
    $queryRaw: jest.fn().mockResolvedValue(
      rows
        ? [{ id: 'seq-1', prefix, currentNumber }]
        : [],
    ),
    sale: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _max: { saleNumber: maxSale } }),
    },
    purchaseOrder: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _max: { orderNumber: maxPo } }),
    },
    organizationSequence: {
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ prefix, currentNumber: data.currentNumber }),
      ),
    },
  };
}

describe('SequenceService', () => {
  const service = new SequenceService();

  it('increments the counter when it is ahead of the stored rows', async () => {
    const tx = makeTx({ currentNumber: 5, maxSale: 5 });

    const result = await service.nextNumber(
      tx as never,
      'org-1',
      'SALE',
      2026,
    );

    expect(result.number).toBe(6);
    expect(tx.sale.aggregate).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      _max: { saleNumber: true },
    });
  });

  it('continues past the highest stored sale when the counter drifted behind', async () => {
    const tx = makeTx({ currentNumber: 19, maxSale: 416 });

    const result = await service.nextNumber(
      tx as never,
      'org-1',
      'SALE',
      2026,
    );

    expect(result).toEqual({ number: 417, formatted: '417' });
  });

  it('uses the purchase order numbers for a PO sequence', async () => {
    const tx = makeTx({ currentNumber: 0, maxPo: 7, prefix: 'OC' });

    const result = await service.nextNumber(
      tx as never,
      'org-1',
      'PO',
      2026,
    );

    expect(tx.purchaseOrder.aggregate).toHaveBeenCalled();
    expect(tx.sale.aggregate).not.toHaveBeenCalled();
    expect(result).toEqual({ number: 8, formatted: 'OC-8' });
  });

  it('fails loudly when the organization has no sequence row', async () => {
    const tx = makeTx({ currentNumber: 0, rows: false });

    await expect(
      service.nextNumber(tx as never, 'org-1', 'SALE', 2026),
    ).rejects.toThrow(/Sequence not found/);
  });
});
