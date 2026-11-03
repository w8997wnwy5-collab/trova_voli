import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-ink-muted">This page does not exist.</p>
      <Link href="/" className="mt-6 inline-block font-medium text-brand underline">
        Start a new search
      </Link>
    </div>
  );
}
