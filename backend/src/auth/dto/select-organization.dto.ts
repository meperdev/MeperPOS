import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SelectOrganizationDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Pre-authentication token from login',
  })
  @IsString()
  @MaxLength(2048)
  @IsNotEmpty()
  preAuthToken: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'UUID of the organization to select',
  })
  @IsString()
  @MaxLength(64)
  @IsNotEmpty()
  organizationId: string;
}
