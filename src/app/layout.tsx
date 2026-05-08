import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ViewLlama | Local AI Studio",
  description: "Connect to local Ollama models, run VMs, and analyze documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
