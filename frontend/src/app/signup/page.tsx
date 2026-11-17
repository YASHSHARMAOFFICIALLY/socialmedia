import type { Metadata } from "next";
import { AuthPage } from "@/landing/auth/auth-form";

export const metadata: Metadata = { title: "Create your account | PostRally", robots: { index: false } };

export default function Page() {
  return <AuthPage mode="signup" />;
}
