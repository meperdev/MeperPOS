import {
  IsEmail,
  IsEnum,
  IsNotIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { OrgRole } from '@prisma/client';
import { IsValidPassword } from '../../common/validators/password.policy';

export class AddOrganizationMemberDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  // OWNER is retired (S8 b): the platform panel assigns ADMIN instead, and the
  // service refuses it again for callers that bypass this boundary.
  @IsEnum(OrgRole)
  @IsNotIn([OrgRole.OWNER], {
    message: 'The OWNER role is retired. Assign ADMIN instead.',
  })
  role: OrgRole;

  @IsString()
  @IsOptional()
  @IsValidPassword()
  password?: string;
}
