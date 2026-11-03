'use client';

import { useEffect, useState } from 'react';
import type { SearchRequestInput } from '@/lib/domain/schemas';
import type { SearchResponse } from '@/lib/domain/types';
import { STATIC_MODE } from './runtime';

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; startedAt: number }
  | { status: 'error'; message: string; issues?: { path: string; message: string }[]; retryAfter?: number }
  | { status: 'success'; data: SearchResponse };

/** Runs a search whenever `key` changes; aborts superseded requests. */
export function useSearch(request: SearchRequestInput | null, key: string, attempt: number): SearchState {
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    // Defer the state change so React does not see a synchronous setState inside the effect.
    const startedAt = Date.now();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setState({ status: 'loading', startedAt });
    });
    if (STATIC_MODE) {
      import('./browser-search')
        .then((m) => m.runBrowserSearch(request))
        .then((r) => {
          if (controller.signal.aborted) return;
          setState(r.ok ? { status: 'success', data: r.data } : { status: 'error', message: r.message, issues: r.issues });
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ status: 'error', message: 'The search failed unexpectedly. Please try again.' });
        });
      return () => controller.abort();
    }
    fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        // A superseded request may finish reading after it was aborted: never show its data.
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setState({
            status: 'error',
            message: json.message ?? `Search failed (${res.status})`,
            issues: json.issues,
            retryAfter: Number(res.headers.get('Retry-After')) || undefined,
          });
          return;
        }
        setState({ status: 'success', data: json as SearchResponse });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError' || controller.signal.aborted) return;
        setState({ status: 'error', message: 'Network error: check your connection and try again.' });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the request
  }, [key, attempt]);
  return state;
}
