import {
  DEVELOPMENT_DATABASE,
  TEST_DATABASE,
  redirectFromDevelopmentDatabase,
} from './test-database';

describe('redirectFromDevelopmentDatabase', () => {
  it('moves a URL that names the development database to the test database', () => {
    expect(
      redirectFromDevelopmentDatabase(
        `postgresql://admin:admin123@localhost:5432/${DEVELOPMENT_DATABASE}?schema=public`,
      ),
    ).toBe(
      `postgresql://admin:admin123@localhost:5432/${TEST_DATABASE}?schema=public`,
    );
  });

  it('keeps credentials, host, port and query untouched', () => {
    const redirected = new URL(
      redirectFromDevelopmentDatabase(
        `postgres://user:p%40ss@db.local:6543/${DEVELOPMENT_DATABASE}?schema=x&sslmode=disable`,
      ) as string,
    );
    expect(redirected.username).toBe('user');
    expect(redirected.password).toBe('p%40ss');
    expect(redirected.host).toBe('db.local:6543');
    expect(redirected.pathname).toBe(`/${TEST_DATABASE}`);
    expect(redirected.searchParams.get('schema')).toBe('x');
    expect(redirected.searchParams.get('sslmode')).toBe('disable');
  });

  it.each([
    [
      'the CI test database',
      `postgresql://postgres:postgres@localhost:5432/${TEST_DATABASE}`,
    ],
    ['a disposable database', 'postgresql://postgres@127.0.0.1:55471/occ'],
    [
      'a database whose name only contains the development name',
      'postgresql://a@h/inventario_db_copy',
    ],
  ])('leaves %s alone', (_label, url) => {
    expect(redirectFromDevelopmentDatabase(url)).toBeUndefined();
  });

  it.each([[undefined], [''], ['not a url']])(
    'ignores a missing or unparsable value: %p',
    (value) => {
      expect(redirectFromDevelopmentDatabase(value)).toBeUndefined();
    },
  );
});
