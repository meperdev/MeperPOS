import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { OrganizationStatusGuard } from '../guards/organization-status.guard';
import { OrganizationStatusInterceptor } from './organization-status.interceptor';

/**
 * The regression this spec exists for: the status guard was registered as a
 * global APP_GUARD, which runs before the route JwtAuthGuard. With no user on
 * the request it returned true, so a PAST_DUE tenant could still write on every
 * route that did not list the guard explicitly. The interceptor runs after the
 * route guards, which is the moment the status is readable.
 */
let currentUser: Record<string, unknown> | undefined;

class AuthShimGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}

@Controller('probe')
@UseGuards(AuthShimGuard)
class ProbeController {
  @Get()
  read() {
    return { ok: 'read' };
  }

  @Post()
  write() {
    return { ok: 'write' };
  }
}

describe('OrganizationStatusInterceptor wiring', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        AuthShimGuard,
        OrganizationStatusGuard,
        { provide: APP_INTERCEPTOR, useClass: OrganizationStatusInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    currentUser = {
      organizationId: 'org-1',
      role: 'ADMIN',
      isSuperAdmin: false,
      orgStatus: 'ACTIVE',
    };
  });

  it('blocks a PAST_DUE write once authentication resolved the user', async () => {
    currentUser = { ...currentUser, orgStatus: 'PAST_DUE' };

    const response = await request(app.getHttpServer())
      .post('/probe')
      .expect(403);

    expect(response.body).toMatchObject({
      status: 'PAST_DUE',
      message:
        'Organization is past due. Write operations are disabled until the payment is settled.',
    });
  });

  it('keeps reads available for a PAST_DUE organization', async () => {
    currentUser = { ...currentUser, orgStatus: 'PAST_DUE' };

    await request(app.getHttpServer())
      .get('/probe')
      .expect(200, { ok: 'read' });
  });

  it('blocks a SUSPENDED write', async () => {
    currentUser = { ...currentUser, orgStatus: 'SUSPENDED' };

    const response = await request(app.getHttpServer())
      .post('/probe')
      .expect(403);

    expect(response.body).toMatchObject({
      status: 'SUSPENDED',
      message: 'Organization is suspended. Write operations are disabled.',
    });
  });

  it('allows an ACTIVE tenant to write', async () => {
    await request(app.getHttpServer())
      .post('/probe')
      .expect(201, { ok: 'write' });
  });

  it('lets a SuperAdmin write regardless of the organization status', async () => {
    currentUser = {
      ...currentUser,
      isSuperAdmin: true,
      role: 'SUPER_ADMIN',
      orgStatus: 'PAST_DUE',
    };

    await request(app.getHttpServer())
      .post('/probe')
      .expect(201, { ok: 'write' });
  });
});
