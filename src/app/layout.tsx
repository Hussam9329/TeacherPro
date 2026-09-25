import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  // Browser chrome follows the palette: Background by day, Deep Dark by night.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBF9EB" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1F36" },
  ],
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
        <Toaster position="bottom-center" dir="rtl" richColors closeButton mobileOffset={12} />
      </body>
    </html>
  );
}
