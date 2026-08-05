export function StokeLogo({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-7 place-items-center rounded-full bg-zinc-950 text-[11px] font-semibold text-white ${className}`}
    >
      S
    </span>
  );
}
