import {
  decideEpisode,
  renderStockAlertMessage,
  STOCK_ALERT_MESSAGE_LIMIT,
} from './stock-alerts.logic';

describe('decideEpisode', () => {
  it('opens episode 1 for a product that was never low', () => {
    expect(decideEpisode(null, true)).toEqual({ action: 'open', episode: 1 });
  });

  it('keeps the open episode of a product that is still low', () => {
    expect(decideEpisode({ state: 'OPEN', episode: 3 }, true)).toEqual({
      action: 'keep',
    });
  });

  it('reopens with the next episode after a recovery', () => {
    expect(decideEpisode({ state: 'RESOLVED', episode: 2 }, true)).toEqual({
      action: 'reopen',
      episode: 3,
    });
  });

  it('resolves an open episode when the product recovers', () => {
    expect(decideEpisode({ state: 'OPEN', episode: 1 }, false)).toEqual({
      action: 'resolve',
    });
  });

  it('leaves a resolved episode alone', () => {
    expect(decideEpisode({ state: 'RESOLVED', episode: 1 }, false)).toEqual({
      action: 'keep',
    });
  });
});

describe('renderStockAlertMessage', () => {
  const product = (n: number) => ({
    name: `Producto ${n}`,
    sku: `SKU-${n}`,
    stock: n,
    minStock: 5,
  });

  it('uses the singular for one product', () => {
    const message = renderStockAlertMessage([product(1)]);

    expect(message).toContain('1 producto llegó a su mínimo');
    expect(message).toContain('• Producto 1 (SKU-1): 1 uds · mínimo 5');
    expect(message).toContain('Revisa Inventario → Stock bajo en MeperPOS.');
  });

  it('counts the batch and never includes a link', () => {
    const message = renderStockAlertMessage([product(1), product(2)]);

    expect(message).toContain('2 productos llegaron a su mínimo');
    expect(message).not.toMatch(/https?:\/\//);
  });

  it('bounds the list and summarizes the rest', () => {
    const many = Array.from({ length: STOCK_ALERT_MESSAGE_LIMIT + 3 }, (_, i) =>
      product(i + 1),
    );

    const message = renderStockAlertMessage(many);

    expect(message.match(/• /g)).toHaveLength(STOCK_ALERT_MESSAGE_LIMIT);
    expect(message).toContain('… y 3 productos más.');
    expect(message).toContain('13 productos llegaron a su mínimo');
  });
});
