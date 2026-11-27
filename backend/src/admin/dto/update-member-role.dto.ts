import { IsEnum, IsNotIn } from 'class-validator';
import { OrgRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  // OWNER is retired (S8 b): moving a member into it would re-create the role
  // the migration just collapsed, so the value is refused here and again in the
  // service.
  @IsEnum(OrgRole)
  @IsNotIn([OrgRole.OWNER], {
    message: 'The OWNER role is retired. Assign ADMIN instead.',
  })
  role: OrgRole;
}
