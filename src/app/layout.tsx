import type { Metadata } from "next";
import ClientErrorReporter from "./components/ClientErrorReporter";
import "./globals.css";

export const metadata: Metadata = {
  title: "PeakUI | Local AI Studio",
  description: "Connect to local Ollama models, run VMs, and analyze documents.",
  icons: {
    icon: [
      { url: '/logo-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/logo-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [
      { url: '/logo-180.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: '/logo-32.png',
  },
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
