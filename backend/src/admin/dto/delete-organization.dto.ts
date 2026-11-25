import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DeleteOrganizationDto {
  @IsString()
  @MaxLength(100)
  @IsNotEmpty()
  confirmOrganizationName: string;
}
