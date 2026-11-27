import type { RowError } from '../../engine/import-sheet-handler.interface';
import { normalizeText } from '../row-validator';
import { validatePasswordPolicy } from '../../../common/validators/password.policy';

/**
 * Assignable organization roles: exactly the current OrgRole values. OWNER and
 * MEMBER no longer exist (the primary owner is an ADMIN membership with
 * isPrimaryOwner), so a row cannot ask for either of them.
 */
export const USER_ROLES = ['ADMIN', 'CASHIER', 'INVENTORY_USER'] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Role applied when a row does not specify one. */
export const DEFAULT_USER_ROLE: UserRole = 'CASHIER';

/** Normalized user import data after validation. */
export interface UserImportData {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}

export type UserValidationResult =
  | { ok: true; data: UserImportData }
  | { ok: false; error: RowError };

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Validates a single mapped Usuarios row before creation.
 *
 * Password strength is delegated to the shared {@link validatePasswordPolicy}
 * (minimum length plus a common/breached-password denylist) so the importer
 * enforces the exact same policy as the auth DTOs. bcrypt(12) hashing and the
 * nested `OrganizationUser` membership are applied downstream by
 * `UsersService.create`, which is the single creation path for users.
 */
export function validateUserRow(
  mapped: Record<string, unknown>,
): UserValidationResult {
  const email = normalizeText(mapped.email);
  const password = normalizeText(mapped.password);
  const name = normalizeText(mapped.name);

  const mappedData: Record<string, unknown> = { email, password, name };

  if (!email) {
    return {
      ok: false,
      error: {
        errorCode: 'EMPTY_EMAIL',
        message: 'Correo electronico requerido',
        field: 'email',
        mappedData,
      },
    };
  }

  if (!isValidEmail(email)) {
    return {
      ok: false,
      error: {
        errorCode: 'INVALID_EMAIL',
        message: 'Correo electronico invalido',
        field: 'email',
        mappedData,
      },
    };
  }

  if (!password) {
    return {
      ok: false,
      error: {
        errorCode: 'EMPTY_PASSWORD',
        message: 'Contraseña requerida',
        field: 'password',
        mappedData,
      },
    };
  }

  const policyMessage = validatePasswordPolicy(password);
  if (policyMessage) {
    return {
      ok: false,
      error: {
        errorCode: 'INVALID_PASSWORD',
        message: policyMessage,
        field: 'password',
        mappedData,
      },
    };
  }

  if (!name) {
    return {
      ok: false,
      error: {
        errorCode: 'EMPTY_NAME',
        message: 'Nombre de usuario requerido',
        field: 'name',
        mappedData,
      },
    };
  }

  const rawRole = normalizeText(mapped.role);
  const role = (
    rawRole ? rawRole.toUpperCase() : DEFAULT_USER_ROLE
  ) as UserRole;

  if (!USER_ROLES.includes(role)) {
    return {
      ok: false,
      error: {
        errorCode: 'INVALID_ROLE',
        message: 'Rol de usuario invalido',
        field: 'role',
        mappedData: { ...mappedData },
      },
    };
  }

  return {
    ok: true,
    data: {
      email,
      password,
      name,
      role,
    },
  };
}
