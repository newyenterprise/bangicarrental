/**
 * Password rules for optional password sign-in. They match the Supabase Auth
 * setting "Lowercase, uppercase letters, digits and symbols" and are checked
 * here first so the renter sees exactly which rule is missing.
 */
export const PASSWORD_MIN = 8;
/** bcrypt, used by Supabase Auth, only reads the first 72 bytes. */
export const PASSWORD_MAX = 72;

export type PasswordRule = 'length' | 'lower' | 'upper' | 'digit' | 'symbol';

export function passwordProblems(password: string): PasswordRule[] {
  const problems: PasswordRule[] = [];
  const bytes = new TextEncoder().encode(password).length;
  if (password.length < PASSWORD_MIN || bytes > PASSWORD_MAX) problems.push('length');
  if (!/[a-z]/.test(password)) problems.push('lower');
  if (!/[A-Z]/.test(password)) problems.push('upper');
  if (!/[0-9]/.test(password)) problems.push('digit');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('symbol');
  return problems;
}
