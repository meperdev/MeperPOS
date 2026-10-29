import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('WAHA Compose isolation', () => {
  it('keeps postgres Compose independent of WAHA configuration', () => {
    const main = readFileSync(
      resolve(__dirname, '../../docker-compose.yml'),
      'utf8',
    );
    expect(main).toContain('postgres:');
    expect(/waha|WAHA_/i.test(main)).toBe(false);
    expect(main).toContain('postgres_data:/var/lib/postgresql/data');
  });
  it('keeps WAHA opt-in, private, persistent and explicitly configured', () => {
    const waha = readFileSync(
      resolve(__dirname, '../../docker-compose.waha.yml'),
      'utf8',
    );
    expect(waha).toContain('${WAHA_IMAGE:?');
    expect(waha).toContain('${WAHA_API_KEY:?');
    expect(waha).toContain('waha_sessions:/app/.sessions');
    expect(waha).toContain('waha_private:');
    expect(waha).not.toMatch(/^\s*(ports|network_mode):/m);
    expect(waha).not.toMatch(/^\s*postgres:/m);
  });
});
