/** Colours for the seeded accounts, from the design; any other id gets a stable colour from its text. */
const KNOWN: Record<string, string> = {
  'user-alice': '#2B4CE0',
  'user-bob': '#C2410C',
  'user-carol': '#0F766E',
};
const FALLBACK = ['#6D28D9', '#B45309', '#0369A1', '#BE185D'];

function colourFor(id: string): string {
  const known = KNOWN[id];
  if (known) return known;
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[hash % FALLBACK.length]!;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0]! : '')).toUpperCase();
}

/** Decorative initials in a coloured circle. The person's name is always shown in text next to it. */
export function Avatar({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ background: colourFor(id), width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials(name)}
    </span>
  );
}
