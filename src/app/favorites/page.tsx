import type { Metadata } from 'next';
import { FavoritesList } from '@/components/favorites/favorites-list';

export const metadata: Metadata = { title: 'Favourites' };

export default function FavoritesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold">Favourites</h1>
      <p className="mt-1 text-sm text-ink-muted">Saved in this browser only. Prices are as found when saved — open the search to check today&apos;s price.</p>
      <FavoritesList />
    </div>
  );
}
