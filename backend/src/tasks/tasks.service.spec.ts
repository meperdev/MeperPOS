import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TaskEventType, TaskStatus, OrgRole } from '@prisma/client';
import { TasksService } from './tasks.service';
import type { RequestUser } from '../common/interfaces/request-user.interface';

describe('TasksService', () => {
  let service: TasksService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
    organizationUser: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    task: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    taskEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const baseUser: RequestUser = {
    userId: 'user-1',
    email: 'test@example.com',
    organizationId: 'org-1',
    role: OrgRole.CASHIER,
    tokenVersion: 1,
    isSuperAdmin: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => unknown) =>
        callback(prismaMock),
    );
    service = new TasksService(prismaMock as never);
  });

  it('creates a task and appends the initial immutable event', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
    prismaMock.task.create.mockResolvedValue({
      id: 'task-1',
      title: 'Revisar stock',
      status: TaskStatus.PENDING,
      createdById: 'user-1',
    });
    prismaMock.taskEvent.create.mockResolvedValue({ id: 'event-1' });

    const result = await service.create(baseUser, { title: 'Revisar stock' });

    expect(prismaMock.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Revisar stock',
          organizationId: 'org-1',
          createdById: 'user-1',
        }),
      }),
    );
    expect(prismaMock.taskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'task-1',
        organizationId: 'org-1',
        type: TaskEventType.CREATED,
        toStatus: TaskStatus.PENDING,
        createdById: 'user-1',
      }),
    });
    expect(result).toEqual(expect.objectContaining({ id: 'task-1' }));
  });

  it('rejects invalid status transitions without appending events', async () => {
    prismaMock.task.findFirst.mockResolvedValue({
      id: 'task-2',
      title: 'Cerrar caja',
      status: TaskStatus.PENDING,
      createdById: 'user-2',
      assignedToId: null,
      deletedAt: null,
    });

    await expect(
      service.updateStatus(
        'task-2',
        { ...baseUser, userId: 'user-2' },
        { status: 'PENDING' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
    expect(prismaMock.taskEvent.create).not.toHaveBeenCalled();
  });

  it('appends status history without mutating prior timeline events', async () => {
    prismaMock.task.findFirst.mockResolvedValue({
      id: 'task-immut-1',
      title: 'Etiquetar productos',
      status: TaskStatus.PENDING,
      createdById: 'admin-1',
      assignedToId: 'cashier-9',
      deletedAt: null,
    });
    prismaMock.task.update.mockResolvedValue({
      id: 'task-immut-1',
      status: TaskStatus.IN_PROGRESS,
    });
    prismaMock.taskEvent.create.mockResolvedValue({ id: 'event-immut-2' });

    await expect(
      service.updateStatus(
        'task-immut-1',
        { ...baseUser, userId: 'cashier-9' },
        { status: TaskStatus.IN_PROGRESS, note: 'Tomada para ejecucion' },
      ),
    ).resolves.toEqual({
      id: 'task-immut-1',
      status: TaskStatus.IN_PROGRESS,
    });

    expect(prismaMock.taskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'task-immut-1',
        type: TaskEventType.STATUS_CHANGED,
        fromStatus: TaskStatus.PENDING,
        toStatus: TaskStatus.IN_PROGRESS,
        createdById: 'cashier-9',
      }),
    });
    expect(prismaMock.taskEvent.update).not.toHaveBeenCalled();
    expect(prismaMock.taskEvent.delete).not.toHaveBeenCalled();
  });

  it('scopes list queries to organization and supports myTasksOnly filter', async () => {
    prismaMock.task.findMany.mockResolvedValue([]);

    await service.findAll(
      { ...baseUser, userId: 'cashier-1' },
      { includeCompleted: false, myTasksOnly: true },
    );

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ organizationId: 'org-1' }),
            expect.objectContaining({
              OR: [{ createdById: 'cashier-1' }, { assignedToId: 'cashier-1' }],
            }),
          ]),
        }),
      }),
    );
  });

  it('lists active members of the organization as assignees', async () => {
    prismaMock.organizationUser.findMany.mockResolvedValue([
      {
        role: OrgRole.ADMIN,
        user: { id: 'u-1', name: 'Ana Admin', email: 'ana@example.com' },
      },
      {
        role: OrgRole.CASHIER,
        user: { id: 'u-2', name: 'Carlos Cajero', email: 'carlos@example.com' },
      },
    ]);

    const assignees = await service.getAssignees(baseUser);

    expect(prismaMock.organizationUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          user: { active: true },
        },
      }),
    );
    expect(assignees).toEqual([
      {
        id: 'u-1',
        name: 'Ana Admin',
        email: 'ana@example.com',
        role: OrgRole.ADMIN,
      },
      {
        id: 'u-2',
        name: 'Carlos Cajero',
        email: 'carlos@example.com',
        role: OrgRole.CASHIER,
      },
    ]);
  });

  it('soft deletes tasks and appends a deletion event', async () => {
    prismaMock.task.findFirst.mockResolvedValue({
      id: 'task-3',
      title: 'Arqueo final',
      status: TaskStatus.COMPLETED,
      createdById: 'admin-1',
      assignedToId: null,
      deletedAt: null,
    });
    prismaMock.task.update.mockResolvedValue({ id: 'task-3' });
    prismaMock.taskEvent.create.mockResolvedValue({ id: 'event-3' });

    await expect(
      service.remove('task-3', {
        ...baseUser,
        userId: 'admin-1',
        role: OrgRole.ADMIN,
      }),
    ).resolves.toEqual({ message: 'Task deleted successfully' });

    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-3' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prismaMock.taskEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'task-3',
        organizationId: 'org-1',
        type: TaskEventType.DELETED,
        createdById: 'admin-1',
      }),
    });
  });

  it('scopes all queries by organizationId', async () => {
    prismaMock.task.findMany.mockResolvedValue([]);

    await service.findAll(baseUser, { includeCompleted: false });

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ organizationId: 'org-1' }),
          ]),
        }),
      }),
    );
  });

  it('rejects assignment to inactive users', async () => {
    prismaMock.task.findFirst.mockResolvedValue({
      id: 'task-5',
      title: 'Contar billetes',
      status: TaskStatus.PENDING,
      createdById: 'admin-1',
      assignedToId: null,
      deletedAt: null,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-x',
      userId: 'user-x',
      organizationId: 'org-1',
      user: { active: false },
    });

    await expect(
      service.update(
        'task-5',
        { ...baseUser, userId: 'admin-1', role: OrgRole.ADMIN },
        { assignedToId: 'user-x' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects assigning a task to a user without membership in the organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-ext',
      active: true,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue(null);

    await expect(
      service.create(baseUser, {
        title: 'Tarea cruzada',
        assignedToId: 'user-ext',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.task.create).not.toHaveBeenCalled();
  });

  it('assigns tasks to active members of the same organization', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-2',
      userId: 'user-2',
      organizationId: 'org-1',
      user: { active: true },
    });
    prismaMock.task.create.mockResolvedValue({
      id: 'task-9',
      title: 'Tarea interna',
      status: TaskStatus.PENDING,
      createdById: 'user-1',
    });
    prismaMock.taskEvent.create.mockResolvedValue({ id: 'event-9' });

    const result = await service.create(baseUser, {
      title: 'Tarea interna',
      assignedToId: 'user-2',
    });

    expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-2', organizationId: 'org-1' },
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: 'task-9' }));
  });
});
