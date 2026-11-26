/** Design tokens (DESIGN_SYSTEM section 3.1). Single source for desktop and portal; CSS variables are generated from this. */
export const tokens = {
  em: '#064E3B', deep: '#003527', brass: '#B48E43', 'brass-ink': '#8A6A2B', 'brass-lt': '#C9A55B',
  teal: '#0F766E', ivory: '#F4F5F0', white: '#FFFFFF',
  ink: '#0F172A', ink2: '#334155', ink3: '#566377',
  line: '#DADDD0', 'line-2': '#C9CEBF', 'line-strong': '#6B7C73',
  zebra: '#FAFAF6', hover: '#EEF1EA',
  ok: '#166534', bad: '#B42318', warn: '#92400E',
  'ok-tint': '#E6F2EA', 'bad-tint': '#FBEAE8', 'warn-tint': '#FBF0E1', 'teal-tint': '#E1F0EE', 'brass-tint': '#F4ECD9',
  'side-text': '#CFE3DA', 'side-text-2': '#9FB8AC',
} as const;
export type TokenName = keyof typeof tokens;

export function toCssVariables(t: Record<string, string> = tokens): string {
  return ':root{' + Object.entries(t).map(([k, v]) => `--${k}:${v};`).join('') + '}';
}

/** Text/background pairs that the product actually uses. Every new pair must be added here with a minimum ratio
 *  (DESIGN_SYSTEM 3.2); the contrast test fails the build below the minimum. `min` 4.5 = AA text, 3 = large text/UI. */
export const usedPairs: { fg: TokenName; bg: TokenName; min: number; use: string }[] = [
  { fg: 'ink', bg: 'ivory', min: 4.5, use: 'body text on app background' },
  { fg: 'ink', bg: 'white', min: 4.5, use: 'body text on sheets' },
  { fg: 'ink2', bg: 'ivory', min: 4.5, use: 'secondary text' },
  { fg: 'ink3', bg: 'ivory', min: 4.5, use: 'helper text' },
  { fg: 'ink3', bg: 'white', min: 4.5, use: 'helper text on sheets' },
  { fg: 'em', bg: 'ivory', min: 4.5, use: 'headings, secondary button text' },
  { fg: 'white', bg: 'em', min: 4.5, use: 'primary button' },
  { fg: 'white', bg: 'teal', min: 4.5, use: 'info fills' },
  { fg: 'white', bg: 'bad', min: 4.5, use: 'danger button' },
  { fg: 'white', bg: 'ok', min: 4.5, use: 'success fills' },
  { fg: 'teal', bg: 'ivory', min: 4.5, use: 'links' },
  { fg: 'teal', bg: 'white', min: 4.5, use: 'links on sheets' },
  { fg: 'brass-ink', bg: 'ivory', min: 4.5, use: 'brass-coloured text on light' },
  { fg: 'brass-ink', bg: 'white', min: 4.5, use: 'brass-coloured text on sheets' },
  { fg: 'brass-lt', bg: 'deep', min: 4.5, use: 'brass text on the sidebar' },
  { fg: 'side-text', bg: 'deep', min: 4.5, use: 'sidebar text' },
  { fg: 'side-text-2', bg: 'deep', min: 4.5, use: 'sidebar secondary text' },
  { fg: 'ok', bg: 'ok-tint', min: 4.5, use: 'status badge' },
  { fg: 'bad', bg: 'bad-tint', min: 4.5, use: 'status badge' },
  { fg: 'warn', bg: 'warn-tint', min: 4.5, use: 'status badge' },
  { fg: 'teal', bg: 'teal-tint', min: 4.5, use: 'status badge' },
  { fg: 'ink2', bg: 'line', min: 4.5, use: 'neutral badge (archived)' },
  { fg: 'white', bg: 'deep', min: 4.5, use: 'toast, sidebar headings' },
  { fg: 'warn', bg: 'white', min: 4.5, use: 'warning banner text' },
  { fg: 'bad', bg: 'white', min: 4.5, use: 'field errors' },
  { fg: 'ok', bg: 'white', min: 4.5, use: 'confirmations' },
  { fg: 'line-strong', bg: 'white', min: 3, use: 'input borders (UI component)' },
  { fg: 'line-strong', bg: 'ivory', min: 3, use: 'control borders on app background' },
];
