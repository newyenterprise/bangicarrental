/** Money is stored as integer sen. 35000 -> "RM350", 35050 -> "RM350.50". */
export function formatRM(sen: number): string {
  const negative = sen < 0;
  const abs = Math.abs(sen);
  const ringgit = Math.floor(abs / 100);
  const cents = abs % 100;
  const whole = ringgit.toLocaleString('en-MY');
  return `${negative ? '-' : ''}RM${whole}${cents ? '.' + String(cents).padStart(2, '0') : ''}`;
}

/** "350", "350.5", "350.50" -> 35000 / 35050. Returns null when not a valid amount. */
export function parseRM(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/rm/i, '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}
