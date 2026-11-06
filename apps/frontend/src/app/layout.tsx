import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "sileo/styles.css";
import { AuthProvider } from "@/modules/auth/providers/auth-provider";
import { Toaster } from "@/shared/components/toaster";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Acceleratio Cloud Console",
  description:
    "Operator console for Acceleratio, an open-source, self-hosted cloud platform. Deploy and manage services, servers and storage on your own cluster.",
  // A private control plane: keep it out of search results.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Runtime API URL for the browser; see src/api/index.ts. */}
        <Script src="/runtime-config.js" strategy="beforeInteractive" />
        <AuthProvider>{children}</AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
