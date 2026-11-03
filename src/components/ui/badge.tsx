import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'brand' | 'good' | 'warn' | 'bad' | 'demo';

const TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-ink-muted border-line',
  brand: 'bg-brand-soft text-brand-strong border-transparent',
  good: 'bg-good-soft text-good border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
  demo: 'bg-demo-soft text-demo border-transparent',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', TONES[tone], className)}
      {...props}
    />
  );
}
