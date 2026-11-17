import type { Metadata } from "next";
import { mdAlt } from "@/lib/ai-pages";
import Link from "next/link";
import { productName as name } from "@/landing/content";
import { LegalPage } from "@/landing/legal-page";

export const metadata: Metadata = {
  title: `Terms of Service | ${name}`,
  description: `The rules for using ${name}, the social media scheduler.`,
  alternates: { canonical: "/terms", types: mdAlt("/terms") },
};

export default function Page() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms apply when you use {name} to schedule and publish posts. By creating an account you agree to
        them. Our <Link href="/privacy">Privacy Policy</Link> explains how we handle your data.
      </p>

      <h2>Your account</h2>
      <p>
        You are responsible for your account and for everything published through it. Keep your password safe and
        only connect social accounts you are allowed to manage.
      </p>

      <h2>Acceptable use</h2>
      <p>Do not use {name} to:</p>
      <ul>
        <li>post spam, or content that is illegal, harassing, hateful or infringes someone else&apos;s rights;</li>
        <li>impersonate people or mislead others about who is posting;</li>
        <li>get around a platform&apos;s limits, or automate actions a platform does not allow;</li>
        <li>attack, overload or try to break into {name} or the networks it connects to.</li>
      </ul>
      <p>We may remove content or suspend accounts that break these rules.</p>

      <h2>Your content</h2>
      <p>
        You own the posts and media you create or upload. You give us a limited license to store, process and
        publish that content only where and when you tell us to, and only to run {name}. That license ends when you
        delete the content or your workspace.
      </p>

      <h2>Social platforms</h2>
      <p>
        When you publish to YouTube, LinkedIn, X, Instagram, Facebook, Threads, Pinterest, TikTok, Bluesky, Mastodon
        or Telegram, that platform&apos;s own terms and rules also apply to you. For YouTube, that includes the{" "}
        <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>. Platforms can change their APIs or
        revoke access, and we are not responsible for what they do.
      </p>

      <h2>Billing</h2>
      <p>
        Paid plans are billed through Dodo Payments. You can cancel at any time; your plan stays active until the end
        of the period you paid for.
      </p>

      <h2>No warranty</h2>
      <p>
        {name} is provided &quot;as is&quot;. We work to keep it running, but we do not promise it will be uninterrupted or
        error-free, or that every post will publish on time.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or consequential losses, lost profits or lost
        data. Our total liability for any claim is limited to the amount you paid us in the 12 months before the claim.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can stop using {name} and delete your workspace at any time. We may suspend or close accounts that break
        these terms. When an account is closed, its data is deleted as described in the Privacy Policy.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms. We will change the date above and tell you about significant changes in the app or
        by email. If you keep using {name} after a change, the new terms apply.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: contact us through the support option in the app.</p>
    </LegalPage>
  );
}
