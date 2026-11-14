import {
  Controller,
  Get,
  Header,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { DailyReportService } from './daily-report.service';
import { renderDailyReportPdf } from './daily-report.pdf';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports/daily-report')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
@Roles(OrgRole.ADMIN)
export class DailyReportController {
  constructor(private readonly service: DailyReportService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser() user: RequestUser) {
    return this.service.generate(user.organizationId);
  }

  @Get('pdf')
  @Header('Cache-Control', 'private, no-store')
  async pdf(@CurrentUser() user: RequestUser) {
    const report = await this.service.generate(user.organizationId);
    return new StreamableFile(renderDailyReportPdf(report), {
      type: 'application/pdf',
      disposition: `attachment; filename="daily-report-${report.date}.pdf"`,
    });
  }
}
