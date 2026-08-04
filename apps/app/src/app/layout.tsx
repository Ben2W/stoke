import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stoke",
  description: "Managed development environments for local work, agents, and CI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
