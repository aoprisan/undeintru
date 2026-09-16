/** Parse a grade using decimal digits so truncation never rounds or loses a hundredth. */
export function parseMediaInput(raw: string): number | null {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(raw.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = match[2] ?? '';
  if (whole < 1 || whole > 10 || (whole === 10 && /[1-9]/.test(fraction))) return null;
  const hundredths = whole * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  return hundredths / 100;
}
