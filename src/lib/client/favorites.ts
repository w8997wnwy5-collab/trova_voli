'use client';

import { useSyncExternalStore } from 'react';
import type { Itinerary } from '@/lib/domain/types';

// Favourites live in this browser only (no account, no server-side personal data).

export interface Favorite {
  id: string;
  savedAt: number;
  /** Query string of the search that produced it (with focus=id). */
  search: string;
  title: string;
  itinerary: Itinerary;
}

const KEY = 'flight-hacker:favorites:v1';
const MAX = 30;
const listeners = new Set<() => void>();
let cache: Favorite[] | null = null;
const EMPTY: Favorite[] = [];

function read(): Favorite[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as Favorite[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list: Favorite[]) {
  cache = list;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: keep in memory for this session */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, read, () => EMPTY);
  return {
    favorites,
    isFavorite: (id: string) => favorites.some((f) => f.id === id),
    toggle: (fav: Omit<Favorite, 'savedAt'>) => {
      const list = read();
      if (list.some((f) => f.id === fav.id)) write(list.filter((f) => f.id !== fav.id));
      else write([{ ...fav, savedAt: Date.now() }, ...list].slice(0, MAX));
    },
    remove: (id: string) => write(read().filter((f) => f.id !== id)),
  };
}
