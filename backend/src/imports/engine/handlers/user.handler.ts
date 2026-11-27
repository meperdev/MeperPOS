import { Injectable } from '@nestjs/common';
import type {
  ImportSheetHandler,
  ParsedFileRow,
  SheetRowContext,
  ValidationResult,
} from '../import-sheet-handler.interface';
import {
  detectColumns,
  mapRawRow,
  type SheetColumnDetectionResult,
} from '../../helpers/column-detector';
import { validateUserRow } from '../../helpers/validators/user';
import { normalizeLookupKey } from '../../helpers/row-validator';
import { UsersService } from '../../../users/users.service';

const USER_EDITABLE_FIELDS = ['email', 'password', 'name', 'role'];

/**
 * Per-entity handler for the Usuarios sheet. It maps the raw sheet columns,
 * validates each row with the shared user validator (role set, password policy
 * delegated to {@link validatePasswordPolicy}, role default CASHIER) and
 * delegates creation to {@link UsersService.create}, which creates the global
 * `User` plus the nested `OrganizationUser` membership.
 *
 * Email uniqueness is global, so {@link SheetRowContext.existingKeys} holds the
 * emails already registered plus the ones seen earlier in this file; the
 * validator does not check duplicates, so the handler does it here and reports
 * the row with DUPLICATE_EMAIL before creation.
 */
@Injectable()
export class UserHandler implements ImportSheetHandler {
  readonly sheetId = 'usuarios';
  readonly requiredFields = ['email', 'password'];
  readonly editableFields = USER_EDITABLE_FIELDS;

  constructor(private readonly usersService: UsersService) {}

  detectColumns(headers: string[]): SheetColumnDetectionResult {
    return detectColumns(this.sheetId, headers);
  }

  validateRow(row: ParsedFileRow, ctx: SheetRowContext): ValidationResult {
    const mapped = mapRawRow(this.sheetId, row.rawData);
    const result = validateUserRow(mapped);

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const emailKey = normalizeLookupKey(result.data.email);
    if (ctx.existingKeys.has(emailKey)) {
      return {
        ok: false,
        error: {
          errorCode: 'DUPLICATE_EMAIL',
          message: 'Ya existe un usuario con ese correo',
          field: 'email',
          mappedData: { ...result.data },
        },
      };
    }

    ctx.existingKeys.add(emailKey);
    return { ok: true, data: { ...result.data } };
  }

  async createRow(
    data: Record<string, unknown>,
    ctx: SheetRowContext,
  ): Promise<void> {
    // The importer is the actor: an ADMIN row needs the primary owner or a
    // SUPER_ADMIN, exactly as POST /api/users does. No role fails closed.
    const actor = ctx.actorRole
      ? {
          userId: ctx.userId,
          role: ctx.actorRole,
          isSuperAdmin: ctx.actorRole === 'SUPER_ADMIN',
        }
      : undefined;
    await this.usersService.create(data as never, ctx.organizationId, actor);
  }
}
