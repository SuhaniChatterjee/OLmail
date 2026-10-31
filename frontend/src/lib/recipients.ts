const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SINGLE_EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export const isValidEmail = (value: string) => SINGLE_EMAIL_RE.test(value.trim());

/** Pull every email address out of a CSV / text file, regardless of column layout. */
export function extractEmails(text: string): string[] {
  return dedupe(text.match(EMAIL_RE) ?? []);
}

export function dedupe(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const key = e.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
