import {
  decodeAddress,
  parsePaymentUri,
  type DecodedAddress,
  type NetworkId
} from '@kristatech/sdk';

export type ParsedMobileLink =
  | {
      readonly kind: 'payment';
      readonly address: string;
      readonly amountKrista?: string;
      readonly label?: string;
      readonly message?: string;
      readonly network: NetworkId;
      readonly decoded: DecodedAddress;
      readonly raw: string;
    }
  | {
      readonly kind: 'invalid';
      readonly reason: string;
      readonly raw: string;
    };

function normalizeUriCandidate(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // Handle `krista://pay?address=KT...&amount=1.5` or `kristatech://pay?address=...`
  if (lower.startsWith('krista://') || lower.startsWith('kristatech://')) {
    const schemeEnd = trimmed.indexOf('://');
    const rest = trimmed.slice(schemeEnd + 3);
    const qIdx = rest.indexOf('?');
    const hostOrAddr = (qIdx === -1 ? rest : rest.slice(0, qIdx)).replace(/^\/+|\/+$/g, '');
    const query = qIdx === -1 ? '' : rest.slice(qIdx + 1);
    if (hostOrAddr.toLowerCase() === 'pay' || hostOrAddr === '') {
      const params = new URLSearchParams(query);
      const targetAddr = params.get('address')?.trim() ?? '';
      if (!targetAddr) {
        return 'kristatech:invalid';
      }
      params.delete('address');
      const remaining = params.toString();
      return remaining ? `kristatech:${targetAddr}?${remaining}` : `kristatech:${targetAddr}`;
    }
    return query ? `kristatech:${hostOrAddr}?${query}` : `kristatech:${hostOrAddr}`;
  }

  // Normalize `krista:KT...?amount=...` -> `kristatech:KT...?amount=...`
  if (lower.startsWith('krista:')) {
    return `kristatech:${trimmed.slice('krista:'.length)}`;
  }

  return trimmed;
}

/**
 * Parses incoming QR payloads or OS deep-links (`krista:`, `krista://`, `kristatech:`,
 * `kristatech://`, or bare KRISTA P2PKH/Taproot/Script addresses) into a validated payment intent.
 */
export function parseIncomingMobileLink(
  raw: string,
  expectedNetwork?: NetworkId
): ParsedMobileLink {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { kind: 'invalid', reason: 'Empty link or QR code', raw };
  }

  const normalized = normalizeUriCandidate(trimmed);
  try {
    const parsed = parsePaymentUri(normalized, expectedNetwork);
    return {
      kind: 'payment',
      address: parsed.address,
      amountKrista: parsed.amount,
      label: parsed.label,
      message: parsed.message,
      network: parsed.decoded.network,
      decoded: parsed.decoded,
      raw
    };
  } catch (err) {
    return {
      kind: 'invalid',
      reason: err instanceof Error ? err.message : String(err),
      raw
    };
  }
}
