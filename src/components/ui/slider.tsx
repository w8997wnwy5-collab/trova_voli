'use client';

import { Slider as RadixSlider } from 'radix-ui';
import { cn } from './cn';

export function Slider({ className, thumbLabel, ...props }: React.ComponentProps<typeof RadixSlider.Root> & { thumbLabel: string }) {
  const count = (props.value ?? props.defaultValue ?? [0]).length;
  return (
    <RadixSlider.Root className={cn('relative flex h-6 w-full touch-none select-none items-center', className)} {...props}>
      <RadixSlider.Track className="relative h-2 grow overflow-hidden rounded-full bg-subtle">
        <RadixSlider.Range className="absolute h-full bg-brand" />
      </RadixSlider.Track>
      {Array.from({ length: count }, (_, i) => (
        <RadixSlider.Thumb
          key={i}
          aria-label={thumbLabel}
          className="block h-5 w-5 rounded-full border-2 border-brand bg-surface shadow transition-transform hover:scale-110"
        />
      ))}
    </RadixSlider.Root>
  );
}
