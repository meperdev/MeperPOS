import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    example: 'correct-horse-battery-staple',
    description:
      'New password (min 10 chars, must not be a commonly breached password)',
    minLength: 10,
    maxLength: 128,
  })
  @IsString()
  @IsValidPassword()
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: OrgRole.CASHIER,
    enum: OrgRole,
    description:
      'Organization role. OWNER is retired and no longer assignable; ADMIN is reserved for the primary owner or a SUPER_ADMIN.',
  })
  @IsOptional()
  @IsEnum(OrgRole)
  @IsNotIn([OrgRole.OWNER], {
    message: 'The OWNER role is retired. Assign ADMIN instead.',
  })
  role?: OrgRole;
}
