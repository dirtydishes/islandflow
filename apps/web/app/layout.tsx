import "./globals.css";
import type { ReactNode } from "react";
import { ThemeProvider } from "./providers/theme";

export const metadata = {
  title: "Islandflow",
  description: "Realtime options flow & off-exchange analysis"
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
