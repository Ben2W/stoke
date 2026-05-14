export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 22 22"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="17" height="17" rx="3" />
      <path d="M6.5 7.5h6a3 3 0 0 1 0 6h-6" />
      <path d="M6.5 13.5v4" />
      <path d="M11.5 13.5l4 4" />
    </svg>
  );
}
