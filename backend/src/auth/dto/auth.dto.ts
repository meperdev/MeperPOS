import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  MinLength,
  IsEnum,
  IsOptional,
  IsUUID,
  IsNotEmpty,
  MaxLength,
} from 'class-validator';
import {
  IsValidPassword,
  PASSWORD_MAX_LENGTH,
} from '../../common/validators/password.policy';

export class LoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 6 })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  @MinLength(6)
  password: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: false,
    description: 'Organization ID to scope the login session',
  })
  @IsUUID()
  @IsOptional()
  organizationId?: string;
}

export class RegisterDto {
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
}

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

  @ApiProperty({
    enum: ['ADMIN', 'CASHIER', 'INVENTORY_USER'],
    example: 'CASHIER',
  })
  @IsEnum(['ADMIN', 'CASHIER', 'INVENTORY_USER'])
  role: 'ADMIN' | 'CASHIER' | 'INVENTORY_USER';
}

export class UpdateProfileDto {
  @ApiProperty({ example: 'John Doe', required: false })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'john@example.com', required: false })
  @IsEmail()
  @IsOptional()
  email?: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'currentPassword123' })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({
    example: 'correct-horse-battery-staple',
    description:
      'New password (min 10 chars, must not be a commonly breached password)',
    minLength: 10,
    maxLength: 128,
  })
  @IsString()
  @IsValidPassword()
  newPassword: string;
}

export class AdminResetPasswordDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the target user whose password will be reset',
  })
  @IsString()
  @IsUUID()
  userId: string;

  @ApiProperty({
    example: 'correct-horse-battery-staple',
    description:
      'New password (min 10 chars, must not be a commonly breached password)',
    minLength: 10,
    maxLength: 128,
  })
  @IsString()
  @IsValidPassword()
  newPassword: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    example: 'a1b2c3d4e5f6...',
    description:
      'Refresh token raw string. Optional: when omitted, the refresh_token cookie is used.',
    required: false,
  })
  @IsString()
  @MaxLength(256)
  @IsOptional()
  refreshToken?: string;
}

export class SelectOrgDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the organization to select',
  })
  @IsUUID()
  organizationId: string;
}
