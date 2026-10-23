export function relTime(unixSeconds: number): string {
  const d = Date.now() / 1000 - unixSeconds;
  if (d < 45) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.round(d / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const shortSha = (sha: string) => sha.slice(0, 7);
