import {
  INestApplication,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { configureApp, configureErrorHandling } from '../app-configuration';
import { PayrollModule } from './payroll.module';

describe('Payroll HTTP integration', () => {
  let app: INestApplication;
  const prisma = {
    employee: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      updateManyAndReturn: jest.fn(),
    },
    employeeShift: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const actor = { userId: 'user-a', organizationId: 'org-a', role: 'OWNER' };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [PayrollModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          const role = req.headers['x-test-role'];
          if (!role) throw new UnauthorizedException();
          req.user = {
            ...actor,
            role,
            orgStatus: req.headers['x-test-status'] || 'ACTIVE',
            organizationId:
              req.headers['x-test-org'] === 'none' ? undefined : 'org-a',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    configureErrorHandling(app);
    await app.init();
  });
  afterAll(async () => {
    if (app) await app.close();
  });
  beforeEach(() => jest.resetAllMocks());
  const get = (path: string, role = 'OWNER') =>
    request(app.getHttpServer()).get(path).set('x-test-role', role);

  it('requires authentication and allows only owner/admin', async () => {
    await request(app.getHttpServer()).get('/api/employees').expect(401);
    for (const role of ['MEMBER', 'CASHIER', 'INVENTORY_USER'])
      await get('/api/employees', role).expect(403);
    prisma.employee.findMany.mockResolvedValue([]);
    await get('/api/employees', 'ADMIN').expect(200);
    await get('/api/employees').set('x-test-org', 'none').expect(403);
  });

  it.each([
    ['POST employee', 'post', '/api/employees', { name: 'Ada' }],
    [
      'POST shift',
      'post',
      '/api/employees/shifts',
      {
        employeeId: 'e',
        date: '2026-01-01',
        kind: 'FULL_DAY',
        amount: 10,
      },
    ],
    ['PATCH employee', 'patch', '/api/employees/e', { name: 'Ada' }],
    ['PATCH active', 'patch', '/api/employees/e/active', { active: false }],
  ] as const)(
    'denies suspended organization %s without writes',
    async (_label, method, path, body) => {
      prisma.employee.create.mockResolvedValue({ id: 'e' });
      prisma.employee.findFirst.mockResolvedValue({ id: 'e', active: true });
      prisma.employeeShift.create.mockResolvedValue({ id: 's' });
      prisma.employee.updateManyAndReturn.mockResolvedValue([{ id: 'e' }]);
      await request(app.getHttpServer())
        [method](path)
        .set('x-test-role', 'OWNER')
        .set('x-test-status', 'SUSPENDED')
        .send(body)
        .expect(403);
      expect(prisma.employee.create).not.toHaveBeenCalled();
      expect(prisma.employeeShift.create).not.toHaveBeenCalled();
      expect(prisma.employee.updateManyAndReturn).not.toHaveBeenCalled();
    },
  );

  it('allows suspended organizations to read employees', async () => {
    prisma.employee.findMany.mockResolvedValue([]);
    await get('/api/employees').set('x-test-status', 'SUSPENDED').expect(200);
    expect(prisma.employee.findMany).toHaveBeenCalled();
  });

  it('passes false query and tenant scope to the real service', async () => {
    prisma.employee.findMany.mockResolvedValue([]);
    await get('/api/employees?active=false').expect(200);
    expect(prisma.employee.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', active: false },
      orderBy: { name: 'asc' },
    });
    await get('/api/employees?active=invalid').expect(400);
  });

  it('routes employee and shift reads with tenant-scoped queries', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    prisma.employeeShift.findFirst.mockResolvedValue(null);
    prisma.employeeShift.findMany.mockResolvedValue([]);
    await get('/api/employees/other').expect(404);
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: { id: 'other', organizationId: 'org-a' },
    });
    await get('/api/employees/shifts/shift-b').expect(404);
    expect(prisma.employeeShift.findFirst).toHaveBeenCalledWith({
      where: { id: 'shift-b', organizationId: 'org-a' },
    });
    await get('/api/employees/employee-b/shifts').expect(200);
    expect(prisma.employeeShift.findMany).toHaveBeenCalledWith({
      where: { employeeId: 'employee-b', organizationId: 'org-a' },
      orderBy: { date: 'asc' },
    });
  });

  it('rejects original JSON type mismatches and unknown properties', async () => {
    for (const body of [
      { name: 42 },
      { name: 'Ada', referenceAmount: '10' },
      { name: 'Ada', organizationId: 'org-b' },
    ])
      await request(app.getHttpServer())
        .post('/api/employees')
        .set('x-test-role', 'OWNER')
        .send(body)
        .expect(400);
    await request(app.getHttpServer())
      .patch('/api/employees/e/active')
      .set('x-test-role', 'OWNER')
      .send({ active: 'false' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/employees/shifts')
      .set('x-test-role', 'OWNER')
      .send({
        employeeId: 'e',
        date: '2026-01-01',
        kind: 'FULL_DAY',
        amount: '10',
      })
      .expect(400);
    expect(prisma.employee.create).not.toHaveBeenCalled();
    expect(prisma.employeeShift.create).not.toHaveBeenCalled();
  });

  it('creates employees and shifts under the authenticated tenant', async () => {
    prisma.employee.create.mockResolvedValue({ id: 'e', name: 'Ada' });
    await request(app.getHttpServer())
      .post('/api/employees')
      .set('x-test-role', 'ADMIN')
      .send({ name: 'Ada', referenceAmount: 10 })
      .expect(201);
    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: { name: 'Ada', referenceAmount: 10, organizationId: 'org-a' },
    });
    prisma.employee.findFirst.mockResolvedValue({ id: 'e', active: true });
    prisma.employeeShift.create.mockResolvedValue({ id: 's' });
    await request(app.getHttpServer())
      .post('/api/employees/shifts')
      .set('x-test-role', 'OWNER')
      .send({
        employeeId: 'e',
        date: '2026-01-01',
        kind: 'FULL_DAY',
        amount: 10,
        observation: 'manual',
      })
      .expect(201);
    expect(prisma.employeeShift.create).toHaveBeenCalledWith({
      data: {
        employeeId: 'e',
        organizationId: 'org-a',
        date: new Date('2026-01-01T00:00:00.000Z'),
        kind: 'FULL_DAY',
        amount: 10,
        observation: 'manual',
      },
    });
  });

  it('rejects zero shifts but accepts the smallest positive amount and zero employee reference salary', async () => {
    prisma.employee.create.mockResolvedValue({ id: 'e' });
    await request(app.getHttpServer())
      .post('/api/employees')
      .set('x-test-role', 'OWNER')
      .send({ name: 'Ada', referenceAmount: 0 })
      .expect(201);
    expect(prisma.employee.create).toHaveBeenCalledWith({
      data: { name: 'Ada', referenceAmount: 0, organizationId: 'org-a' },
    });

    const shift = {
      employeeId: 'e',
      date: '2026-01-01',
      kind: 'FULL_DAY',
    };
    prisma.employee.findFirst.mockResolvedValue({ id: 'e', active: true });
    prisma.employeeShift.create.mockResolvedValue({ id: 's' });
    await request(app.getHttpServer())
      .post('/api/employees/shifts')
      .set('x-test-role', 'OWNER')
      .send({ ...shift, amount: 0 })
      .expect(400);
    expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    expect(prisma.employeeShift.create).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/api/employees/shifts')
      .set('x-test-role', 'OWNER')
      .send({ ...shift, amount: 0.01 })
      .expect(201);
    expect(prisma.employeeShift.create).toHaveBeenCalledWith({
      data: {
        ...shift,
        date: new Date('2026-01-01T00:00:00.000Z'),
        amount: 0.01,
        organizationId: 'org-a',
      },
    });
  });

  it('does not create shifts or update employees outside the tenant', async () => {
    prisma.employee.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post('/api/employees/shifts')
      .set('x-test-role', 'OWNER')
      .send({
        employeeId: 'foreign',
        date: '2026-01-01',
        kind: 'FULL_DAY',
        amount: 10,
      })
      .expect(404);
    expect(prisma.employeeShift.create).not.toHaveBeenCalled();
    prisma.employee.updateManyAndReturn.mockResolvedValue([]);
    await request(app.getHttpServer())
      .patch('/api/employees/foreign')
      .set('x-test-role', 'OWNER')
      .send({ name: 'Ada' })
      .expect(404);
    expect(prisma.employee.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'foreign', organizationId: 'org-a' },
      data: { name: 'Ada' },
    });
  });

  it('prevents shifts for inactive employees and scopes active changes', async () => {
    prisma.employee.findFirst.mockResolvedValue({ id: 'e', active: false });
    await request(app.getHttpServer())
      .post('/api/employees/shifts')
      .set('x-test-role', 'OWNER')
      .send({
        employeeId: 'e',
        date: '2026-01-01',
        kind: 'FULL_DAY',
        amount: 10,
      })
      .expect(409);
    expect(prisma.employee.findFirst).toHaveBeenCalledWith({
      where: { id: 'e', organizationId: 'org-a' },
      select: { id: true, active: true },
    });
    expect(prisma.employeeShift.create).not.toHaveBeenCalled();
    prisma.employee.updateManyAndReturn.mockResolvedValue([
      { id: 'e', active: false },
    ]);
    await request(app.getHttpServer())
      .patch('/api/employees/e/active')
      .set('x-test-role', 'ADMIN')
      .send({ active: false })
      .expect(200);
    expect(prisma.employee.updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: 'e', organizationId: 'org-a' },
      data: { active: false },
    });
  });
});
