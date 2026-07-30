import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "NoteNext - Ephemeral Encrypted Pastebin",
  description: "Zero-knowledge end-to-end encrypted ephemeral note sharing platform.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${jetbrainsMono.variable} h-full w-full`}
    >
      <body className="h-full w-full flex flex-col overflow-hidden bg-[#212121]">
        {children}
      </body>
    </html>
  );
}

