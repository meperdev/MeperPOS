import { validateUserRow, USER_ROLES, DEFAULT_USER_ROLE } from './user';
import { validatePasswordPolicy } from '../../../common/validators/password.policy';
import { PASSWORD_MIN_LENGTH } from '../../../common/validators/password.policy';

describe('USER_ROLES', () => {
  it('defines the assignable organization role set (S1: the three roles)', () => {
    expect(USER_ROLES).toEqual(['ADMIN', 'CASHIER', 'INVENTORY_USER']);
  });

  it('defaults the role to CASHIER', () => {
    expect(DEFAULT_USER_ROLE).toBe('CASHIER');
  });
});

describe('validateUserRow', () => {
  const baseRow = {
    email: 'user@example.com',
    password: 'correct-horse-battery-staple',
    name: 'John Doe',
  };

  it('accepts a valid user row and defaults the role to CASHIER', () => {
    const result = validateUserRow(baseRow);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        email: 'user@example.com',
        password: 'correct-horse-battery-staple',
        name: 'John Doe',
        role: 'CASHIER',
      });
    }
  });

  it('accepts an explicit valid role and normalizes its case', () => {
    const result = validateUserRow({ ...baseRow, role: 'admin' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.role).toBe('ADMIN');
    }
  });

  it.each(['OWNER', 'MEMBER'])('rejects the retired %s role', (role) => {
    const result = validateUserRow({ ...baseRow, role });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('INVALID_ROLE');
      expect(result.error.field).toBe('role');
    }
  });

  it('rejects an unknown role value', () => {
    const result = validateUserRow({ ...baseRow, role: 'SUPERADMIN' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('INVALID_ROLE');
      expect(result.error.field).toBe('role');
    }
  });

  it('rejects a password shorter than the shared policy minimum', () => {
    const result = validateUserRow({ ...baseRow, password: 'short' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('INVALID_PASSWORD');
      expect(result.error.message).toBe(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      );
      expect(result.error.field).toBe('password');
    }
  });

  it('rejects a denylisted common password via the shared policy', () => {
    const result = validateUserRow({ ...baseRow, password: 'password123' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('INVALID_PASSWORD');
      expect(result.error.message).toBe('This password is too common');
    }
  });

  it('delegates password validation to the shared policy function', () => {
    // The policy must be the single source of truth: a password that the
    // shared policy rejects must be rejected with its exact message.
    const sharedPolicyMessage = validatePasswordPolicy('welcome123');
    const result = validateUserRow({ ...baseRow, password: 'welcome123' });

    expect(sharedPolicyMessage).not.toBeNull();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(sharedPolicyMessage);
    }
  });

  it('rejects a row without a password', () => {
    const result = validateUserRow({
      email: 'user@example.com',
      name: 'John Doe',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('EMPTY_PASSWORD');
      expect(result.error.field).toBe('password');
    }
  });

  it('rejects a row without an email', () => {
    const result = validateUserRow({
      password: 'correct-horse-battery-staple',
      name: 'John Doe',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('EMPTY_EMAIL');
      expect(result.error.field).toBe('email');
    }
  });

  it('rejects a malformed email address', () => {
    const result = validateUserRow({ ...baseRow, email: 'not-an-email' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('INVALID_EMAIL');
      expect(result.error.field).toBe('email');
    }
  });

  it('rejects a row without a name', () => {
    const result = validateUserRow({
      email: 'user@example.com',
      password: 'correct-horse-battery-staple',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.errorCode).toBe('EMPTY_NAME');
      expect(result.error.field).toBe('name');
    }
  });
});
