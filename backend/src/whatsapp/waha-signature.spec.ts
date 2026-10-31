import { deriveWebhookKey, verifyWahaSignature } from './waha-signature';

describe('WAHA webhook signature', () => {
  const body = Buffer.from(
    '{"event":"message","session":"default","engine":"WEBJS"}',
  );
  const signature =
    '208f8a55dde9e05519e898b10b89bf0d0b3b0fdf11fdbf09b6b90476301b98d8097c462b2b17a6ce93b6b47a136cf2e78a33a63f6752c2c1631777076153fa89';

  it('accepts the official raw-body SHA-512 example', () => {
    expect(
      verifyWahaSignature(body, 'my-secret-key', signature, 'sha512'),
    ).toBe(true);
  });

  it('rejects changed bytes, missing credentials and invalid headers', () => {
    expect(
      verifyWahaSignature(
        Buffer.concat([body, Buffer.from(' ')]),
        'my-secret-key',
        signature,
        'sha512',
      ),
    ).toBe(false);
    expect(verifyWahaSignature(body, '', signature, 'sha512')).toBe(false);
    expect(
      verifyWahaSignature(body, 'my-secret-key', signature, 'sha256'),
    ).toBe(false);
    expect(
      verifyWahaSignature(
        body,
        'my-secret-key',
        signature.toUpperCase(),
        'sha512',
      ),
    ).toBe(false);
    expect(
      verifyWahaSignature(body, 'my-secret-key', 'z'.repeat(128), 'sha512'),
    ).toBe(false);
    expect(
      verifyWahaSignature(undefined, 'my-secret-key', signature, 'sha512'),
    ).toBe(false);
  });
});

describe('per-session webhook key derivation', () => {
  const master = 'master-webhook-key';

  it('derives a stable key per session that differs from the master', () => {
    const commercial = deriveWebhookKey(master, 'meper-commercial-abc');
    expect(commercial).toBe(deriveWebhookKey(master, 'meper-commercial-abc'));
    expect(commercial).toMatch(/^[0-9a-f]{64}$/);
    expect(commercial).not.toBe(master);
    expect(deriveWebhookKey(master, 'meper-intelligence')).not.toBe(commercial);
  });

  it('does not reveal the master key or another session key from one session', () => {
    const commercial = deriveWebhookKey(master, 'meper-commercial-abc');
    expect(commercial).not.toContain(master);
    expect(deriveWebhookKey('other-master', 'meper-commercial-abc')).not.toBe(
      commercial,
    );
  });

  it('refuses to derive without a master key', () => {
    expect(deriveWebhookKey('', 'meper-intelligence')).toBeNull();
  });
});
