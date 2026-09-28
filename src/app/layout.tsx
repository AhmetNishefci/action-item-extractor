import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Action Item Extractor",
  description: "Turn meeting notes into trackable action items.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
