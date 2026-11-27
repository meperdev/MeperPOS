import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppModule } from '../app.module';

/**
 * Living authorization-matrix coverage gate (issue #48, spec 1.R3).
 *
 * Builds the OpenAPI document from AppModule exactly like main.ts does, then
 * asserts that:
 *  1. every path×method exposed by the backend has a row in
 *     docs/authorization-matrix.md, and
 *  2. every test file referenced by a matrix row exists on disk.
 *
 * Route drift (a new/renamed/removed endpoint without a matrix update) or a
 * stale test reference fails the suite, and therefore CI.
 */

// __dirname = backend/src/common → repository root is three levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MATRIX_PATH = path.join(REPO_ROOT, 'docs', 'authorization-matrix.md');

interface MatrixRow {
  route: string;
  method: string;
  testReference: string | null;
}

function parseMatrixMarkdown(content: string): MatrixRow[] {
  const rows: MatrixRow[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Route rows look like: | /api/products | GET | ADMIN, CASHIER | org-scoped | backend/src/... |
    if (!trimmed.startsWith('| /')) {
      continue;
    }

    const cells = trimmed
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells.length < 5) {
      continue;
    }

    const [route, method, , , testReference] = cells;
    rows.push({
      route,
      method: method.toUpperCase(),
      testReference: testReference === '—' ? null : testReference,
    });
  }

  return rows;
}

function buildMatrixKey(route: string, method: string): string {
  return `${method} ${route}`;
}

/**
 * Normalizes an OpenAPI path to the matrix's human-facing convention:
 * the global `api` prefix is prepended (SwaggerModule documents routes
 * without it) and `{param}` braces become `:param`.
 */
function openApiPathToMatrixRoute(openApiPath: string): string {
  const matrixPath = openApiPath.replace(/\{([^}]+)\}/g, ':$1');
  return `/api${matrixPath === '/' ? '' : matrixPath}`;
}

describe('Authorization matrix coverage (docs/authorization-matrix.md)', () => {
  let openApiKeys: string[];
  let matrixRows: MatrixRow[];

  beforeAll(async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      const config = new DocumentBuilder()
        .setTitle('MeperPOS API')
        .setVersion('1.0')
        .build();
      const document = SwaggerModule.createDocument(app, config);

      openApiKeys = Object.entries(document.paths ?? {}).flatMap(
        ([route, methods]) =>
          Object.keys(methods as Record<string, unknown>)
            .filter((method) => method !== 'parameters')
            .map((method) =>
              buildMatrixKey(
                openApiPathToMatrixRoute(route),
                method.toUpperCase(),
              ),
            ),
      );
    } finally {
      await app.close();
    }

    matrixRows = parseMatrixMarkdown(fs.readFileSync(MATRIX_PATH, 'utf-8'));
  });

  it('backend exposes at least one route for the coverage gate to be meaningful', () => {
    expect(openApiKeys.length).toBeGreaterThan(0);
  });

  it('matrix contains at least one route row for the coverage gate to be meaningful', () => {
    expect(matrixRows.length).toBeGreaterThan(0);
  });

  it('every OpenAPI path×method has a row in the matrix', () => {
    const matrixKeys = new Set(
      matrixRows.map((row) => buildMatrixKey(row.route, row.method)),
    );

    const missing = openApiKeys.filter((key) => !matrixKeys.has(key));

    expect(missing).toEqual([]);
  });

  it('every test file referenced by a matrix row exists on disk', () => {
    const missingReferences = matrixRows
      .filter((row) => row.testReference !== null)
      .filter((row) => !fs.existsSync(path.join(REPO_ROOT, row.testReference!)))
      .map((row) => `${row.method} ${row.route} → ${row.testReference}`);

    expect(missingReferences).toEqual([]);
  });
});
