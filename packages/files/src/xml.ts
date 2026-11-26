/** XML export. Tag names are fixed English identifiers (valid XML names); values are escaped and stripped of characters
 *  that XML 1.0 forbids, so any user text produces a well-formed document. */
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿\uD800-\uDFFF]/g;
export const xmlEscape = (s: string): string =>
  s.replace(INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export interface XmlSpec { root: string; item: string; attributes?: Record<string, string>; records: Record<string, string | number | null>[] }
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
const assertName = (n: string) => { if (!NAME.test(n)) throw new Error(`invalid xml name: ${n}`); };

export function toXml(spec: XmlSpec): string {
  assertName(spec.root); assertName(spec.item);
  const attrs = Object.entries(spec.attributes ?? {}).map(([k, v]) => { assertName(k); return ` ${k}="${xmlEscape(v)}"`; }).join('');
  const body = spec.records.map((rec) => {
    const fields = Object.entries(rec).map(([k, v]) => { assertName(k); return v === null || v === '' ? `    <${k}/>` : `    <${k}>${xmlEscape(String(v))}</${k}>`; }).join('\n');
    return `  <${spec.item}>\n${fields}\n  </${spec.item}>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${spec.root}${attrs}>\n${body}${body ? '\n' : ''}</${spec.root}>\n`;
}
