/** Phone numbers (OD-037, OD-045). Pure.
 *  ASSUMPTION (flagged, not an association rule): numbers are Algerian by default (country code 213). Mobile numbers are 05/06/07 followed by 8 digits; other national numbers are landlines.
 *  Excel drops a leading zero from numeric cells, so a 9-digit number starting with 5, 6 or 7 is read as a mobile number missing its zero. */
export const DEFAULT_COUNTRY_CODE = '213';
const westernDigits = (s: string): string => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));

export interface PhoneOk { ok: true; /** how it is shown and stored: national "0550123456" or international "+33612345678" */ display: string; /** digits only with country code, for wa.me */ e164: string; kind: 'mobile' | 'landline' | 'international'; whatsapp: boolean }
export type PhoneResult = PhoneOk | { ok: false };

export function normalizePhone(raw: string | number | null | undefined): PhoneResult {
  if (raw === null || raw === undefined) return { ok: false };
  let s = westernDigits(String(raw)).trim(); if (!s) return { ok: false };
  if (/[^\d\s().+\-/]/.test(s)) return { ok: false }; // letters or other symbols: not a phone number
  const plus = s.startsWith('+') || s.startsWith('00'); s = s.replace(/\D/g, ''); if (s.startsWith('00')) s = s.slice(2);
  const cc = DEFAULT_COUNTRY_CODE;
  if (plus || (s.startsWith(cc) && s.length >= 11 && s.length <= 12)) {
    if (s.length < 8 || s.length > 15) return { ok: false };
    if (s.startsWith(cc)) return national('0' + s.slice(cc.length));
    return { ok: true, display: '+' + s, e164: s, kind: 'international', whatsapp: true };
  }
  if (/^[567]\d{8}$/.test(s)) s = '0' + s; // Excel removed the leading zero of a mobile number
  return national(s);
}
function national(s: string): PhoneResult {
  if (/^0[567]\d{8}$/.test(s)) return { ok: true, display: s, e164: DEFAULT_COUNTRY_CODE + s.slice(1), kind: 'mobile', whatsapp: true };
  if (/^0\d{8}$/.test(s)) return { ok: true, display: s, e164: DEFAULT_COUNTRY_CODE + s.slice(1), kind: 'landline', whatsapp: false };
  return { ok: false };
}
/** "0550 12 34 56" for reading; the stored value stays unspaced. */
export const prettyPhone = (display: string): string => (/^0\d{9}$/.test(display) ? display.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4') : display);

/** The chat link opened in the user's own WhatsApp; the program never sends anything itself. */
export function whatsappUrl(e164: string, text: string): string {
  if (!/^\d{8,15}$/.test(e164)) throw new RangeError('invalid number');
  return `https://wa.me/${e164}?text=${encodeURIComponent(text)}`;
}
export const WHATSAPP_PREFIX = 'https://wa.me/';
