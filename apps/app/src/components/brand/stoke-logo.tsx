"use client";

export function StokeLogo({ className = "" }: { className?: string }) {
  return (
    <img
      alt=""
      className={`size-7 rounded-full ${className}`}
      height={28}
      src="/stoke-logo.png"
      width={28}
    />
  );
}
