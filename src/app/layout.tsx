import type { Metadata } from "next";
import ClientErrorReporter from "./components/ClientErrorReporter";
import "./globals.css";

export const metadata: Metadata = {
  title: "PeakUI | Local AI Studio",
  description: "Connect to local Ollama models, run VMs, and analyze documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ClientErrorReporter />
        {children}
      </body>
    </html>
  );
}
