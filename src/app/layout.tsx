import type { ReactNode } from "react";

export const metadata = {
  title: "Throughline",
  description: "Approved ideas into spec-linked GitHub tasks, with the why preserved.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
