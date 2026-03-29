import "./globals.css";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans, Quantico } from "next/font/google";
import { TerminalAppShell } from "./terminal";

const display = Quantico({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-display"
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans"
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono"
});

export const metadata = {
  title: "Islandflow Terminal",
  description: "Realtime options flow and off-exchange analysis terminal"
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${sans.variable} ${mono.variable}`}>
        <TerminalAppShell>{children}</TerminalAppShell>
      </body>
    </html>
  );
}
