'use client';

import { Popover as RadixPopover } from 'radix-ui';
import { cn } from './cn';

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;

export function PopoverContent({ className, ...props }: React.ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        sideOffset={8}
        align="start"
        className={cn('z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-4 text-ink shadow-xl outline-none', className)}
        {...props}
      />
    </RadixPopover.Portal>
  );
}
