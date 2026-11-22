import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UploadImageDto {
  @ApiProperty({ type: 'string', format: 'binary', required: true })
  @IsOptional()
  // eslint-disable-next-line meperpos/require-string-length-bound -- Swagger shape of a multipart binary file, not a text field; no route binds this DTO
  @IsString()
  file: Express.Multer.File;
}
