import { formatMoney } from '@/lib/util/money';

export function fmtMoney(minor: number, currency: string, compact = false): string {
  return formatMoney({ amount: minor, currency }, { compact });
}

export function fmtAge(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return `${h} h ago`;
}
