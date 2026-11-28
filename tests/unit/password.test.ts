import { describe, expect, it } from 'vitest';
import { passwordProblems } from '@/lib/password';

describe('password rules', () => {
  it('accepts a password with every kind of character and enough length', () => {
    expect(passwordProblems('Bangi#2026')).toEqual([]);
  });
  it('names each missing rule', () => {
    expect(passwordProblems('Ab1!')).toEqual(['length']);
    expect(passwordProblems('BANGI#2026')).toEqual(['lower']);
    expect(passwordProblems('bangi#2026')).toEqual(['upper']);
    expect(passwordProblems('Bangi#Rental')).toEqual(['digit']);
    expect(passwordProblems('Bangi2026x')).toEqual(['symbol']);
    expect(passwordProblems('')).toEqual(['length', 'lower', 'upper', 'digit', 'symbol']);
  });
  it('rejects passwords longer than bcrypt can use', () => {
    expect(passwordProblems(`Aa1!${'x'.repeat(69)}`)).toEqual(['length']);
  });
});
