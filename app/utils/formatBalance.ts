export interface SplitKristaBalance {
  readonly whole: string;
  readonly fraction: string;
}

/**
 * Splits a KRISTA decimal amount string (e.g. "14820.50000000") into
 * a comma-grouped integer part ("14,820") and 8-digit decimal part (".50000000").
 */
export function splitKristaBalance(kristaStr: string): SplitKristaBalance {
  const clean = (kristaStr ?? '').trim();
  if (!clean) {
    return { whole: '0', fraction: '.00000000' };
  }

  const negative = clean.startsWith('-');
  const unsigned = negative || clean.startsWith('+') ? clean.slice(1) : clean;
  const [rawInt = '0', rawFrac = ''] = unsigned.split('.');

  const digitsInt = rawInt.replace(/\D/g, '') || '0';
  const normalizedInt = digitsInt.replace(/^0+(?=\d)/, '');
  const groupedInt = normalizedInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const digitsFrac = rawFrac.replace(/\D/g, '');
  const paddedFrac = digitsFrac.slice(0, 8).padEnd(8, '0');

  return {
    whole: `${negative ? '-' : ''}${groupedInt}`,
    fraction: `.${paddedFrac}`
  };
}

/**
 * Formats a KRISTA decimal amount string for compact metric cards while
 * preserving all non-zero fractional satoshis (trims trailing zeros down to `minDecimals`).
 */
export function formatCompactKrista(kristaStr: string, minDecimals = 2): string {
  const { whole, fraction } = splitKristaBalance(kristaStr);
  const rawFrac = fraction.slice(1);
  let trimmed = rawFrac.replace(/0+$/, '');
  if (trimmed.length < minDecimals) {
    trimmed = rawFrac.slice(0, minDecimals);
  }
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}
