import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { MultiSheetImportService } from './multi-sheet-import.service';
import * as protectedDiagnostics from '../common/errors/protected-diagnostics';

type PlanLimitResult = {
  current: number;
  limit: number;
  exceeded: boolean;
};

interface SheetFixture {
  name: string;
  headers: string[];
  rows: Array<Array<string | number>>;
}

async function buildWorkbookBuffer(sheets: SheetFixture[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRow(sheet.headers);
    for (const row of sheet.rows) {
      worksheet.addRow(row);
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function makeFile(buffer: Buffer, name = 'import.xlsx'): Express.Multer.File {
  return {
    buffer,
    originalname: name,
    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } as Express.Multer.File;
}

describe('MultiSheetImportService', () => {
  let service: MultiSheetImportService;
  let prisma: any;
  let planLimits: {
    getLimitStatus: jest.Mock;
    count: jest.Mock;
    invalidateCache: jest.Mock;
    checkLimit: jest.Mock;
  };
  let productsService: { create: jest.Mock };
  let customersService: { create: jest.Mock };
  let suppliersService: { create: jest.Mock };
  let usersService: { create: jest.Mock };

  beforeEach(() => {
    prisma = {
      product: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
      organizationUser: { findMany: jest.fn().mockResolvedValue([]) },
      category: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'cat-1', name: 'General', active: true }),
        update: jest.fn(),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'cat-9', name: 'Nueva', active: true }),
      },
    };
    planLimits = {
      getLimitStatus: jest
        .fn()
        .mockResolvedValue({ current: 0, limit: -1, exceeded: false }),
      count: jest.fn().mockResolvedValue(0),
      invalidateCache: jest.fn(),
      checkLimit: jest
        .fn()
        .mockResolvedValue({ allowed: true, current: 0, limit: -1 }),
    };
    productsService = { create: jest.fn().mockResolvedValue(undefined) };
    customersService = { create: jest.fn().mockResolvedValue(undefined) };
    suppliersService = { create: jest.fn().mockResolvedValue(undefined) };
    usersService = { create: jest.fn().mockResolvedValue(undefined) };

    service = new MultiSheetImportService(
      prisma,
      planLimits as never,
      productsService as never,
      customersService as never,
      suppliersService as never,
      usersService as never,
    );
  });

  async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  describe('sheet resolution order', () => {
    it('processes sheets in Productos -> Clientes -> Proveedores -> Usuarios order regardless of file order', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Clientes',
          headers: ['Nombre', 'Tipo de Documento', 'Documento'],
          rows: [['Cliente Uno', 'CC', '111']],
        },
        {
          name: 'Productos',
          headers: ['Nombre', 'Precio Venta', 'Stock'],
          rows: [['Producto Uno', 5000, 10]],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      expect(productsService.create).toHaveBeenCalledTimes(1);
      expect(customersService.create).toHaveBeenCalledTimes(1);
      const productCall =
        productsService.create.mock.invocationCallOrder[0] ?? 0;
      const customerCall =
        customersService.create.mock.invocationCallOrder[0] ?? 0;
      expect(productCall).toBeLessThan(customerCall);

      const status = service.getImportStatus(started.jobId, 'user-1');
      expect(status.status).toBe('COMPLETED');
      expect(status.sheets.map((sheet) => sheet.sheetId)).toEqual([
        'productos',
        'clientes',
      ]);
      expect(status.importedCount).toBe(2);
    });

    it('skips unknown and missing sheets leniently while recognized sheets still import', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Inventario',
          headers: ['Nombre', 'Precio Venta', 'Stock'],
          rows: [['Ignorado', 100, 1]],
        },
        {
          name: 'Productos',
          headers: ['Nombre', 'Precio Venta', 'Stock'],
          rows: [['Real', 5000, 10]],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      const status = service.getImportStatus(started.jobId, 'user-1');
      expect(status.status).toBe('COMPLETED');
      expect(status.sheets.map((sheet) => sheet.sheetId)).toEqual([
        'productos',
      ]);
      expect(status.sheets[0].imported).toBe(1);
      expect(productsService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('per-sheet column detection', () => {
    it('rejects a sheet missing a required column and keeps processing siblings', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Clientes',
          headers: ['Nombre', 'Documento'],
          rows: [['Cliente Uno', '111']],
        },
        {
          name: 'Productos',
          headers: ['Nombre', 'Precio Venta', 'Stock'],
          rows: [['Producto Uno', 5000, 10]],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      const status = service.getImportStatus(started.jobId, 'user-1');
      expect(status.status).toBe('COMPLETED');
      const clientes = status.sheets.find((s) => s.sheetId === 'clientes');
      expect(clientes?.status).toBe('REJECTED');
      expect(clientes?.missingRequiredFields).toContain('documentType');
      expect(customersService.create).not.toHaveBeenCalled();
      expect(productsService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('plan-limit enforcement', () => {
    it('rejects an Usuarios sheet at the plan limit while other sheets still import', async () => {
      planLimits.getLimitStatus.mockImplementation((type: string) =>
        Promise.resolve(
          type === 'users'
            ? ({ current: 3, limit: 3, exceeded: true } as PlanLimitResult)
            : ({ current: 0, limit: -1, exceeded: false } as PlanLimitResult),
        ),
      );

      const buffer = await buildWorkbookBuffer([
        {
          name: 'Usuarios',
          headers: ['Correo', 'Contraseña', 'Nombre'],
          rows: [['new@example.com', 'correct-horse-battery-staple', 'Nuevo']],
        },
        {
          name: 'Productos',
          headers: ['Nombre', 'Precio Venta', 'Stock'],
          rows: [['Producto Uno', 5000, 10]],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      const status = service.getImportStatus(started.jobId, 'user-1');
      const usuarios = status.sheets.find((s) => s.sheetId === 'usuarios');
      expect(usuarios?.status).toBe('REJECTED');
      expect(usuarios?.planLimitRejected).toBe(true);
      expect(usersService.create).not.toHaveBeenCalled();
      expect(productsService.create).toHaveBeenCalledTimes(1);
      expect(planLimits.invalidateCache).not.toHaveBeenCalledWith(
        'users',
        'org-1',
      );
    });

    it('invalidates the users plan cache after a processed usuarios sheet', async () => {
      planLimits.getLimitStatus.mockResolvedValue({
        current: 1,
        limit: 3,
        exceeded: false,
      } as PlanLimitResult);

      const buffer = await buildWorkbookBuffer([
        {
          name: 'Usuarios',
          headers: ['Correo', 'Contraseña', 'Nombre'],
          rows: [['new@example.com', 'correct-horse-battery-staple', 'Nuevo']],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      const status = service.getImportStatus(started.jobId, 'user-1');
      const usuarios = status.sheets.find((s) => s.sheetId === 'usuarios');
      expect(usuarios?.status).toBe('COMPLETED');
      expect(planLimits.invalidateCache).toHaveBeenCalledWith('users', 'org-1');
      expect(usersService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('partial success', () => {
    it('reports a bad row without aborting the job and imports sibling rows', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Productos',
          headers: ['Nombre', 'Precio Venta', 'Stock'],
          rows: [
            ['Bien', 5000, 10],
            ['Mal', 'precio-invalido', 10],
          ],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      const status = service.getImportStatus(started.jobId, 'user-1');
      expect(status.status).toBe('COMPLETED');
      expect(status.importedCount).toBe(1);
      expect(status.errorCount).toBe(1);
      const sheet = status.sheets.find((s) => s.sheetId === 'productos');
      expect(sheet?.imported).toBe(1);
      expect(sheet?.errors).toBe(1);
      expect(sheet?.rowErrors).toHaveLength(1);
      expect(sheet?.rowErrors[0].code).toBe('INVALID_PRICE');
    });
  });

  describe('empty file', () => {
    it('throws 422 for a workbook with no data rows across sheets', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Productos',
          headers: ['Nombre', 'Precio Venta', 'Stock'],
          rows: [],
        },
      ]);

      await expect(
        service.startFullImport(makeFile(buffer), 'user-1', 'org-1', undefined),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('job status per-sheet breakdown', () => {
    it('returns global counters plus a per-sheet breakdown with counters', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Clientes',
          headers: ['Nombre', 'Tipo de Documento', 'Documento'],
          rows: [
            ['Cliente Uno', 'CC', '111'],
            ['Cliente Dos', 'CC', '222'],
          ],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      const status = service.getImportStatus(started.jobId, 'user-1');
      expect(status.jobId).toBe(started.jobId);
      expect(status.status).toBe('COMPLETED');
      expect(status.totalRows).toBe(2);
      expect(status.processedRows).toBe(2);
      expect(status.importedCount).toBe(2);
      expect(status.sheets).toHaveLength(1);
      expect(status.sheets[0]).toMatchObject({
        sheetId: 'clientes',
        status: 'COMPLETED',
        totalRows: 2,
        processedRows: 2,
        imported: 2,
        skipped: 0,
        errors: 0,
        warnings: 0,
      });
    });
  });

  describe('sheet-aware retry', () => {
    it('retries a failed clientes row against the customer handler and reconciles counters', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Clientes',
          headers: ['Nombre', 'Tipo de Documento', 'Documento'],
          rows: [['', 'CC', '111']],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      let status = service.getImportStatus(started.jobId, 'user-1');
      expect(status.errorCount).toBe(1);
      expect(status.importedCount).toBe(0);

      await service.retryImportRow(
        started.jobId,
        'user-1',
        {
          rowIndex: 2,
          sheetId: 'clientes',
          correctedData: { name: 'Cliente Corregido' },
        },
        OrgRole.ADMIN,
      );

      status = service.getImportStatus(started.jobId, 'user-1');
      expect(status.errorCount).toBe(0);
      expect(status.importedCount).toBe(1);
      expect(customersService.create).toHaveBeenCalledTimes(1);
      const clientes = status.sheets.find((s) => s.sheetId === 'clientes');
      expect(clientes?.rowErrors[0].retriedSuccess).toBe(true);
    });

    it('delegates retry to the correct sheet handler by sheetId', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Clientes',
          headers: ['Nombre', 'Tipo de Documento', 'Documento'],
          rows: [['', 'CC', '111']],
        },
        {
          name: 'Proveedores',
          headers: ['Nombre', 'Documento'],
          rows: [['', '9001-1']],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      expect(customersService.create).not.toHaveBeenCalled();
      expect(suppliersService.create).not.toHaveBeenCalled();

      await service.retryImportRow(
        started.jobId,
        'user-1',
        {
          rowIndex: 2,
          sheetId: 'proveedores',
          correctedData: { name: 'Proveedor Corregido' },
        },
        OrgRole.ADMIN,
      );

      expect(suppliersService.create).toHaveBeenCalledTimes(1);
      expect(customersService.create).not.toHaveBeenCalled();
    });
  });

  describe('handler dispatch', () => {
    it('routes each entity sheet to its matching create service', async () => {
      const buffer = await buildWorkbookBuffer([
        {
          name: 'Productos',
          headers: ['Nombre', 'Precio Venta', 'Stock'],
          rows: [['Producto Uno', 5000, 10]],
        },
        {
          name: 'Clientes',
          headers: ['Nombre', 'Tipo de Documento', 'Documento'],
          rows: [['Cliente Uno', 'CC', '111']],
        },
        {
          name: 'Proveedores',
          headers: ['Nombre', 'Documento'],
          rows: [['Proveedor Uno', '9001-1']],
        },
        {
          name: 'Usuarios',
          headers: ['Correo', 'Contraseña', 'Nombre'],
          rows: [
            ['user@example.com', 'correct-horse-battery-staple', 'Usuario'],
          ],
        },
      ]);

      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
      );

      await flush();

      expect(productsService.create).toHaveBeenCalledTimes(1);
      expect(customersService.create).toHaveBeenCalledTimes(1);
      expect(suppliersService.create).toHaveBeenCalledTimes(1);
      expect(usersService.create).toHaveBeenCalledTimes(1);
      expect(planLimits.invalidateCache).toHaveBeenCalledWith(
        'customers',
        'org-1',
      );
      expect(planLimits.invalidateCache).toHaveBeenCalledWith('users', 'org-1');

      const status = service.getImportStatus(started.jobId, 'user-1');
      expect(status.sheets).toHaveLength(4);
      expect(status.sheets.every((sheet) => sheet.imported === 1)).toBe(true);
    });
  });

  it('sanitizes unexpected row, event, and job diagnostics in multi-sheet status', async () => {
    const marker = 'sensitive-multi-sheet-db-marker';
    productsService.create.mockRejectedValueOnce(new Error(marker));
    const recordDiagnostic = jest.spyOn(
      protectedDiagnostics,
      'recordProtectedDiagnostic',
    );
    const buffer = await buildWorkbookBuffer([
      {
        name: 'Productos',
        headers: ['Nombre', 'Precio Venta', 'Stock'],
        rows: [['Producto Uno', 5000, 10]],
      },
    ]);

    const started = await service.startFullImport(
      makeFile(buffer),
      'user-1',
      'org-1',
      OrgRole.ADMIN,
      'request-multi-1',
    );
    await flush();

    const status = service.getImportStatus(started.jobId, 'user-1');
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(marker);
    expect(status.errors[0]).toMatchObject({
      code: 'IMPORT_ROW_FAILED',
      message: 'The row could not be imported',
      row: 2,
    });
    expect(status.errors[0]).not.toHaveProperty('mappedData');
    expect(status).not.toHaveProperty('fileName');
    expect(status.recentEvents.every((event) => !event.message.includes(marker))).toBe(true);
    expect(recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: started.jobId, row: 2 }),
      expect.any(Error),
    );
  });

  it('turns multi-sheet parser failures into a safe import exception', async () => {
    const marker = 'sensitive-workbook-parser-marker';
    const recordDiagnostic = jest.spyOn(
      protectedDiagnostics,
      'recordProtectedDiagnostic',
    );
    (service as any).parseWorkbook = jest.fn().mockRejectedValue(new Error(marker));

    await expect(
      service.startFullImport(
        makeFile(Buffer.from('invalid')),
        'user-1',
        'org-1',
        OrgRole.ADMIN,
        'request-multi-2',
      ),
    ).rejects.toMatchObject({ message: 'The import file could not be processed' });
    expect(recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ boundary: 'multi-sheet-import-parser', requestId: 'request-multi-2' }),
      expect.any(Error),
    );
  });

  describe('usuarios sheet role gate (privilege-escalation fix)', () => {
    const productosFixture: SheetFixture = {
      name: 'Productos',
      headers: ['Nombre', 'Precio Venta', 'Stock'],
      rows: [['Producto Uno', 5000, 10]],
    };
    const usuariosFixture: SheetFixture = {
      name: 'Usuarios',
      headers: ['Correo', 'Contraseña', 'Nombre', 'Rol'],
      rows: [
        [
          'attacker@example.com',
          'correct-horse-battery-staple',
          'Attacker',
          // The highest assignable role; the row validator refuses any
          // value outside the current OrgRole before the sheet gate.
          'ADMIN',
        ],
      ],
    };

    async function importAs(role: OrgRole | 'SUPER_ADMIN' | undefined) {
      const buffer = await buildWorkbookBuffer([
        productosFixture,
        usuariosFixture,
      ]);
      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        role,
      );
      await flush();
      return service.getImportStatus(started.jobId, 'user-1');
    }

    interface StatusSheet {
      sheetId: string;
      status?: string;
      imported?: number;
      roleRejected?: boolean;
      roleRejectedMessage?: string;
    }

    function sheetOf(
      status: { sheets: StatusSheet[] },
      sheetId: string,
    ): StatusSheet | undefined {
      return status.sheets.find((sheet) => sheet.sheetId === sheetId);
    }

    it.each([OrgRole.CASHIER, OrgRole.INVENTORY_USER])(
      'rejects the usuarios sheet for a %s caller instead of creating the user',
      async (role) => {
        const status = await importAs(role);

        expect(usersService.create).not.toHaveBeenCalled();

        const usuarios = sheetOf(status, 'usuarios');
        expect(usuarios).toMatchObject({
          status: 'REJECTED',
          roleRejected: true,
          roleRejectedMessage: 'La hoja usuarios requiere rol ADMIN',
          imported: 0,
        });

        // The gate is surgical: sibling sheets keep importing.
        const productos = sheetOf(status, 'productos');
        expect(productos).toMatchObject({ imported: 1 });
        expect(productos?.status).not.toBe('REJECTED');
        expect(productsService.create).toHaveBeenCalledTimes(1);
      },
    );

    it('fails closed when the caller role is missing', async () => {
      const status = await importAs(undefined);

      expect(usersService.create).not.toHaveBeenCalled();
      expect(sheetOf(status, 'usuarios')).toMatchObject({
        status: 'REJECTED',
        roleRejected: true,
      });
    });

    it.each([OrgRole.ADMIN, 'SUPER_ADMIN' as const])(
      'still imports the usuarios sheet for a %s caller',
      async (role) => {
        const status = await importAs(role);

        expect(usersService.create).toHaveBeenCalledTimes(1);
        const usuarios = sheetOf(status, 'usuarios');
        expect(usuarios).toMatchObject({ imported: 1 });
        expect(usuarios?.status).not.toBe('REJECTED');
      },
    );

    it('forbids a CASHIER from reaching user creation through the retry endpoint', async () => {
      const buffer = await buildWorkbookBuffer([
        productosFixture,
        usuariosFixture,
      ]);
      const started = await service.startFullImport(
        makeFile(buffer),
        'user-1',
        'org-1',
        OrgRole.CASHIER,
      );
      await flush();

      await expect(
        service.retryImportRow(
          started.jobId,
          'user-1',
          {
            rowIndex: 2,
            sheetId: 'usuarios',
            correctedData: { email: 'attacker@example.com' },
          },
          OrgRole.CASHIER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });
});
