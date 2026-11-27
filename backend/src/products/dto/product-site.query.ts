import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, MaxLength, validate } from 'class-validator';
import {
  normalizeValidationMessage,
  PUBLIC_ERROR_CODES,
} from '../../common/errors/public-error.model';

/**
 * The optional site a product read is scoped to (T3f).
 *
 * The POS catalogue, its search and its quick search may name one site; every
 * other caller keeps reading the organization aggregate. The value is the site
 * id the caller was authorized for, so the boundary only guarantees its shape
 * here — the membership rule belongs to `LocationsService.findAccessible`,
 * which answers 404 for a site the caller cannot read.
 *
 * The three read routes already take their other filters as individual query
 * parameters, so the DTO is applied to this single value instead of replacing
 * them: an absent site must leave those requests byte-identical.
 */
export class ProductSiteQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  locationId?: string;
}

/**
 * Validates the `locationId` query value through {@link ProductSiteQueryDto}
 * and answers the same canonical validation envelope the global pipe produces,
 * so an oversized site never reaches the authorization read.
 */
@Injectable()
export class ProductSiteQueryPipe implements PipeTransform<
  string | undefined,
  Promise<string | undefined>
> {
  async transform(value: string | undefined): Promise<string | undefined> {
    const dto = plainToInstance(ProductSiteQueryDto, { locationId: value });
    const errors = await validate(dto);

    if (errors.length > 0) {
      throw new BadRequestException({
        code: PUBLIC_ERROR_CODES.VALIDATION_ERROR,
        message: normalizeValidationMessage(errors),
        error: 'Bad Request',
      });
    }

    return dto.locationId;
  }
}
