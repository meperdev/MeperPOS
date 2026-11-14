import { Transform, type TransformFnParams } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * Spec S9 — the organization-level activation switch, and the only input a
 * SUPER_ADMIN may send to flip it.
 *
 * `enabled` decides one thing only: whether a registered sale writes its
 * internal PENDING fiscal record. It never issues a document — no CUFE, no
 * invoice number and no DIAN call exist behind it (spec S6).
 *
 * The `@Transform` is not cosmetic. The global `ValidationPipe`
 * (`app-configuration.ts`) runs with `enableImplicitConversion`, and
 * class-transformer converts a boolean-typed property with `Boolean(value)`, so
 * the JSON string `"false"` would arrive as `true` and silently activate an
 * organization. Re-reading the raw body value keeps `@IsBoolean()` honest: only
 * a real JSON boolean is accepted.
 */
export class UpdateElectronicInvoicingDto {
  @Transform(({ obj, key }: TransformFnParams) =>
    typeof obj === 'object' && obj !== null
      ? (obj as Record<string, unknown>)[key]
      : undefined,
  )
  @IsBoolean()
  enabled: boolean;
}
