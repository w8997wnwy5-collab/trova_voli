'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { emptyForm, type SearchFormState } from '@/components/search/form-state';
import { SearchForm } from '@/components/search/search-form';
import { StrategyDrawer } from '@/components/strategy/strategy-drawer';
import type { TripStrategy } from '@/lib/domain/strategy';
import { encodeSearch } from '@/lib/url/search-url';

export function HomeSearch() {
  const router = useRouter();
  const [drawer, setDrawer] = useState<{ strategy: TripStrategy; update: (s: TripStrategy) => void } | null>(null);
  return (
    <>
      <SearchForm
        initial={emptyForm()}
        onSubmit={(request) => router.push(`/search?${encodeSearch({ request })}`)}
        onOpenStrategy={(form: SearchFormState, update) => setDrawer({ strategy: form.strategy, update })}
      />
      {drawer && (
        <StrategyDrawer
          open
          onOpenChange={(open) => !open && setDrawer(null)}
          strategy={drawer.strategy}
          onChange={(s) => {
            drawer.update(s);
            setDrawer({ ...drawer, strategy: s });
          }}
        />
      )}
    </>
  );
}
