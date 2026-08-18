import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mercatus Arena — TechVerse 2026",
  description:
    "Real-time algorithmic trading evaluation terminal for TechVerse 2026.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg font-sans antialiased">
        <link rel="preconnect" href="https://cdn.fontshare.com" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&f[]=general-sans@400,500,600,700,800&display=swap"
          rel="stylesheet"
        />
        {children}
      </body>
    </html>
  );
}
