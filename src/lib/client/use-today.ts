'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const getToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Local calendar date on the client; '' during server rendering (avoids hydration mismatches). */
export function useToday(): string {
  return useSyncExternalStore(subscribe, getToday, () => '');
}
