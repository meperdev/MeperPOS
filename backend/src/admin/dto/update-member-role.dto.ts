import { IsEnum } from 'class-validator';
import { OrgRole } from '@prisma/client';

export class UpdateMemberRoleDto {
  // S9: OWNER and MEMBER are not OrgRole values any more, so a role change
  // cannot re-create either of them.
  @IsEnum(OrgRole)
  role: OrgRole;
}
