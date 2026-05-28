import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { LatinDigitsScript } from "@/components/latin-digits-script";

export const metadata: Metadata = {
  title: "TeacherPro - نظام إدارة الطلاب",
  description: "نظام إدارة الطلاب والامتحانات والفُرص - TeacherPro",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar-IQ-u-nu-latn" dir="rtl" suppressHydrationWarning>
      <head>
        <LatinDigitsScript />
      </head>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster position="top-center" dir="rtl" richColors closeButton />
      </body>
    </html>
  );
}
