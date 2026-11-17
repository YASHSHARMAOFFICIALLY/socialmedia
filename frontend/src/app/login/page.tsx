import type { Metadata } from "next";
import { AuthPage } from "@/landing/auth/auth-form";

export const metadata: Metadata = { title: "Log in | PostRally", robots: { index: false } };

export default function Page() {
  return <AuthPage mode="login" />;
}
