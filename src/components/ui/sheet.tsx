'use client';

import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from './cn';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

/** Side drawer on desktop, bottom sheet on small screens. Focus is trapped while open. */
export function SheetContent({
  title,
  description,
  children,
  footer,
  className,
  side = 'right',
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  side?: 'right' | 'center';
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
      <Dialog.Content
        className={cn(
          'fixed z-50 flex flex-col bg-surface text-ink shadow-2xl outline-none',
          side === 'right'
            ? 'inset-x-0 bottom-0 max-h-[92vh] rounded-t-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[460px] sm:rounded-none sm:rounded-l-2xl'
            : 'left-1/2 top-1/2 max-h-[90vh] w-[min(1100px,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-0.5 text-sm text-ink-muted">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          <Dialog.Close className="rounded-lg p-1.5 text-ink-muted hover:bg-subtle hover:text-ink" aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </Dialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
