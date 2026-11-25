import {
  REQUIRED_PRODUCTION_ORIGINS,
  findMissingProductionOrigins,
  resolveAllowedOrigins,
  warnMissingProductionOrigins,
} from './allowed-origins';

const LOCALHOST_DEFAULTS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const PROD_CORS_ORIGIN = REQUIRED_PRODUCTION_ORIGINS.join(',');

describe('REQUIRED_PRODUCTION_ORIGINS', () => {
  it('covers the two production frontends the 2026-11-22 login rejection exposed', () => {
    expect(REQUIRED_PRODUCTION_ORIGINS).toEqual(
      expect.arrayContaining([
        'https://pos.mepersoft.app',
        'https://pos-pwa.mepersoft.app',
      ]),
    );
  });

  it('keeps every entry an exact Origin: no trailing slash and no Vercel preview', () => {
    for (const origin of REQUIRED_PRODUCTION_ORIGINS) {
      expect(origin).not.toMatch(/\/$/);
      expect(origin).not.toContain('vercel.app');
    }
  });
});

describe('resolveAllowedOrigins', () => {
  it('falls back to the localhost defaults when CORS_ORIGIN is unset', () => {
    expect(resolveAllowedOrigins({})).toEqual(LOCALHOST_DEFAULTS);
  });

  it('falls back to the localhost defaults when CORS_ORIGIN is empty or blank', () => {
    expect(resolveAllowedOrigins({ CORS_ORIGIN: '' })).toEqual(
      LOCALHOST_DEFAULTS,
    );
    expect(resolveAllowedOrigins({ CORS_ORIGIN: ' , , ' })).toEqual(
      LOCALHOST_DEFAULTS,
    );
  });

  it('splits a comma-separated list into exact origins', () => {
    expect(
      resolveAllowedOrigins({
        CORS_ORIGIN: 'https://a.example,https://b.example',
      }),
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('trims whitespace around each entry', () => {
    expect(
      resolveAllowedOrigins({
        CORS_ORIGIN: '  https://a.example ,\t https://b.example  ',
      }),
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('strips trailing slashes so a browser Origin can match the configured entry', () => {
    expect(
      resolveAllowedOrigins({
        CORS_ORIGIN:
          ' https://pos.mepersoft.app/ , https://pos-pwa.mepersoft.app// ',
      }),
    ).toEqual(['https://pos.mepersoft.app', 'https://pos-pwa.mepersoft.app']);
  });

  it('never adds a required production origin to a configured list', () => {
    expect(
      resolveAllowedOrigins({ CORS_ORIGIN: 'https://only.example' }),
    ).toEqual(['https://only.example']);
  });
});

describe('findMissingProductionOrigins', () => {
  it('reports every required origin when CORS_ORIGIN is unset', () => {
    expect(findMissingProductionOrigins({})).toEqual([
      ...REQUIRED_PRODUCTION_ORIGINS,
    ]);
  });

  it('reports nothing when CORS_ORIGIN lists all required origins', () => {
    expect(
      findMissingProductionOrigins({ CORS_ORIGIN: PROD_CORS_ORIGIN }),
    ).toEqual([]);
  });

  it('reports nothing when CORS_ORIGIN lists them with whitespace and trailing slashes', () => {
    const configured = REQUIRED_PRODUCTION_ORIGINS.map(
      (origin) => ` ${origin}/ `,
    ).join(',');

    expect(findMissingProductionOrigins({ CORS_ORIGIN: configured })).toEqual(
      [],
    );
  });

  it('reports the one origin a partial CORS_ORIGIN left out', () => {
    expect(
      findMissingProductionOrigins({
        CORS_ORIGIN: 'https://pos.mepersoft.app',
      }),
    ).toEqual(['https://pos-pwa.mepersoft.app']);
  });
});

describe('warnMissingProductionOrigins', () => {
  let warnSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    exitSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('warns naming the missing origin in production and never exits', () => {
    const missing = warnMissingProductionOrigins({
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://pos.mepersoft.app',
    });

    expect(missing).toEqual(['https://pos-pwa.mepersoft.app']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://pos-pwa.mepersoft.app'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cross-origin login rejected'),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('warns that the localhost defaults are in effect when CORS_ORIGIN is unset in production', () => {
    warnMissingProductionOrigins({ NODE_ENV: 'production' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('localhost defaults'),
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('stays silent when CORS_ORIGIN covers every required origin', () => {
    warnMissingProductionOrigins({
      NODE_ENV: 'production',
      CORS_ORIGIN: PROD_CORS_ORIGIN,
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('stays silent outside production', () => {
    warnMissingProductionOrigins({ NODE_ENV: 'development' });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
