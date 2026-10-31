/** "Tue 9:15:12 AM" — matches the scheduled badge in the design. */
export function formatBadgeTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return `${day} ${time}`;
}

/** "Nov 3, 10:23 AM" */
export function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** "john.smith@x.com" → "John Smith" */
export function nameFromEmail(email: string): string {
  return email
    .split('@')[0]
    .replace(/[._\-+]+/g, ' ')
    .replace(/\d+/g, '')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || email;
}

export function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** Value for <input type="datetime-local"> in local time. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
