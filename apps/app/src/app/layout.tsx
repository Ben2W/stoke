import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://usestoke.dev"),
  title: "Stoke — One project identity, everywhere code runs",
  description: "Managed development environments connecting local checkouts, coding agents, CI, and Vercel Sandbox.",
  openGraph: {
    title: "Stoke — One project identity, everywhere code runs",
    description: "Managed development environments for local work, coding agents, CI, and Vercel Sandbox.",
    siteName: "Stoke",
    type: "website",
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Stoke connects local, managed, and sandbox development environments." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stoke — One project identity, everywhere code runs",
    description: "Managed development environments for local work, coding agents, CI, and Vercel Sandbox.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
