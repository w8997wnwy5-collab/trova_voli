import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchExperience } from '@/components/results/search-experience';
import { LoadingState } from '@/components/results/states';

export const metadata: Metadata = { title: 'Search' };

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="sr-only">Flight search results</h1>
      <Suspense fallback={<LoadingState />}>
        <SearchExperience />
      </Suspense>
    </div>
  );
}
