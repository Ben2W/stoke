const eventWidths = ["w-40", "w-56", "w-32", "w-48", "w-36"];

export function RunEventListSkeleton() {
  return (
    <div aria-busy="true" className="flex h-[32rem] flex-col animate-pulse" role="status">
      <span className="sr-only">Loading run events…</span>
      <div className="border-b border-zinc-100 px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="h-3 w-32 rounded bg-zinc-200" />
            <div className="mt-2 h-2.5 w-44 rounded bg-zinc-100" />
          </div>
          <div className="h-6 w-20 rounded-full bg-zinc-100" />
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-zinc-100">
          <div className="h-full w-1/3 rounded-full bg-zinc-200" />
        </div>
      </div>

      <ol className="flex-1 space-y-3 px-5 py-4" aria-hidden="true">
        {eventWidths.map((width) => (
          <li className="flex items-center gap-3" key={width}>
            <span className="size-3 shrink-0 rounded-full bg-zinc-200" />
            <span className={`h-3 max-w-[65%] rounded bg-zinc-100 ${width}`} />
            <span className="ml-auto h-2.5 w-16 rounded bg-zinc-100" />
          </li>
        ))}
      </ol>
    </div>
  );
}
