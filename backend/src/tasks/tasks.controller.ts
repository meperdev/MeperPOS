import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.strategy';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { OrganizationRequiredGuard } from '../common/guards/organization-required.guard';
import { AdminOrganizationInterceptor } from '../common/interceptors/admin-organization.interceptor';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../common/interfaces/request-user.interface';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard, OrganizationRequiredGuard)
@UseInterceptors(AdminOrganizationInterceptor)
@Roles(OrgRole.ADMIN, OrgRole.CASHIER, OrgRole.INVENTORY_USER)
@ApiBearerAuth()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a dashboard task' })
  create(@Body() dto: CreateTaskDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List visible dashboard tasks' })
  findAll(@Query() query: QueryTasksDto, @CurrentUser() user: RequestUser) {
    return this.tasksService.findAll(user, query);
  }

  @Get('assignees')
  @ApiOperation({
    summary: 'List team members available for task assignment',
  })
  getAssignees(@CurrentUser() user: RequestUser) {
    return this.tasksService.getAssignees(user);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Get immutable timeline for a task' })
  getTimeline(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tasksService.getTimeline(id, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single task' })
  findOne(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tasksService.findOne(id, user);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update task details' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasksService.update(id, user, dto);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update task status and append a timeline event' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.tasksService.updateStatus(id, user, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a task and append a timeline event' })
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.tasksService.remove(id, user);
  }
}
