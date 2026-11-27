import {
  IsEmail,
  IsEnum,
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

  // S9: OWNER and MEMBER are not OrgRole values any more, so `@IsEnum` refuses
  // the retired literals here and the service never sees them.
  @IsEnum(OrgRole)
  role: OrgRole;

  @IsString()
  @IsOptional()
  @IsValidPassword()
  password?: string;
}
