/** Vector rendition of the supplied layered globe, shared across the UI. */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 48 48" className="h-7 w-7 shrink-0" fill="currentColor">
        <ellipse cx="24" cy="6" rx="8" ry="2.7" />
        <path d="M12 9c-3 2-5 4-5 6 0 4 8 7 17 7s17-3 17-7c0-2-2-4-5-6 1 1 1 2 1 3 0 3-6 5-13 5s-13-2-13-5c0-1 0-2 1-3Z" />
        <path d="M4 19c-2 3-3 6-3 8 0 6 10 10 23 10s23-4 23-10c0-2-1-5-3-8 0 5-9 9-20 9S4 24 4 19Z" />
        <path d="M5 34c3 8 10 13 19 13s16-5 19-13c-4 6-11 8-19 8S9 40 5 34Z" />
      </svg>
      <span>Taptap3D</span>
    </span>
  );
}
