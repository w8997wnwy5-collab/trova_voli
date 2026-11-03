/** FNV-1a 32-bit hash: deterministic and fast; not for security. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1) derived from the parts. */
export function rand01(...parts: (string | number)[]): number {
  // Extra avalanche round so that similar keys diverge.
  let h = hash32(parts.join('|'));
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function shortHash(input: string): string {
  return hash32(input).toString(36).padStart(7, '0');
}
