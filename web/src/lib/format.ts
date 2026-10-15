// "42s", "5m", "3h", then "Oct 14" (or "Oct 14, 2025" for older years): the
// compact style timelines use.
export function relativeTime(iso: string, now = Date.now()) {
  const date = new Date(iso);
  const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function joinedDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric',
  });
}

// Characters as people count them: one emoji is one character.
export function charCount(text: string) {
  return [...text].length;
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => [...w][0]?.toUpperCase())
      .join('') || '?'
  );
}
