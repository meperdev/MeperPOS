import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { TasksController } from './tasks.controller';
import type { RequestUser } from '../common/interfaces/request-user.interface';

describe('TasksController', () => {
  const tasksServiceMock = {
    create: jest.fn(),
    updateStatus: jest.fn(),
    getTimeline: jest.fn(),
  };

  const createContext = (
    handler: (...args: unknown[]) => unknown,
    role: OrgRole,
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => TasksController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role } }),
      }),
    }) as unknown as ExecutionContext;

  it('allows every authenticated business role at the tasks boundary', () => {
    const requiredRoles = Reflect.getMetadata(ROLES_KEY, TasksController);

    expect(requiredRoles).toEqual([
      OrgRole.ADMIN,
      OrgRole.CASHIER,
      OrgRole.INVENTORY_USER,
    ]);
  });

  it('delegates assignees retrieval for the authenticated actor', async () => {
    const controller = new TasksController(tasksServiceMock as never);
    const user: RequestUser = {
      userId: 'user-1',
      email: 'test@example.com',
      organizationId: 'org-1',
      role: OrgRole.CASHIER,
      tokenVersion: 1,
      isSuperAdmin: false,
    };
    const assignees = [
      {
        id: 'user-1',
        name: 'User 1',
        email: 'u1@test.com',
        role: OrgRole.CASHIER,
      },
    ];
    tasksServiceMock.getAssignees = jest.fn().mockResolvedValue(assignees);

    await expect(controller.getAssignees(user)).resolves.toEqual(assignees);
    expect(tasksServiceMock.getAssignees).toHaveBeenCalledWith(user);
  });

  it('delegates task creation with the authenticated actor', async () => {
    const controller = new TasksController(tasksServiceMock as never);
    const dto = { title: 'Revisar caja' };
    const user: RequestUser = {
      userId: 'user-1',
      email: 'test@example.com',
      organizationId: 'org-1',
      role: OrgRole.CASHIER,
      tokenVersion: 1,
      isSuperAdmin: false,
    };
    const expected = { id: 'task-1', ...dto };

    tasksServiceMock.create.mockResolvedValue(expected);

    await expect(controller.create(dto, user)).resolves.toEqual(expected);
    expect(tasksServiceMock.create).toHaveBeenCalledWith(user, dto);
  });

  it('delegates status transitions and timeline access', async () => {
    const controller = new TasksController(tasksServiceMock as never);
    const user: RequestUser = {
      userId: 'admin-1',
      email: 'admin@example.com',
      organizationId: 'org-1',
      role: OrgRole.ADMIN,
      tokenVersion: 1,
      isSuperAdmin: false,
    };
    const statusDto = {
      status: 'IN_PROGRESS' as const,
      note: 'Tomada por admin',
    };
    const updatedTask = { id: 'task-9', status: 'IN_PROGRESS' };
    const timeline = [{ id: 'event-1', taskId: 'task-9' }];

    tasksServiceMock.updateStatus.mockResolvedValue(updatedTask);
    tasksServiceMock.getTimeline.mockResolvedValue(timeline);

    await expect(
      controller.updateStatus('task-9', statusDto, user),
    ).resolves.toEqual(updatedTask);
    await expect(controller.getTimeline('task-9', user)).resolves.toEqual(
      timeline,
    );

    expect(tasksServiceMock.updateStatus).toHaveBeenCalledWith(
      'task-9',
      user,
      statusDto,
    );
    expect(tasksServiceMock.getTimeline).toHaveBeenCalledWith('task-9', user);
  });
});
