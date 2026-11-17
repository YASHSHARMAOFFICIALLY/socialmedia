import type { Metadata } from "next";
import { productName as name } from "@/landing/content";
import { LegalPage } from "@/landing/legal-page";

export const metadata: Metadata = {
  title: `Privacy Policy | ${name}`,
  description: `What ${name} collects, why, who processes it and how to delete it.`,
  alternates: { canonical: "/privacy" },
};

export default function Page() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {name} is a tool for scheduling and publishing posts to social networks. This policy explains what data we
        collect when you use {name}, how we use it, who helps us process it, and how you can delete it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Account details: your name and email address. If you sign up with Google, we receive your name, email address and profile picture from Google.</li>
        <li>Connected accounts: when you connect YouTube, LinkedIn, X, Instagram, Facebook Pages, Threads, Pinterest or TikTok, we receive OAuth access and refresh tokens plus basic profile details (account ID, name, handle, avatar). For Bluesky, Mastodon and Telegram we store the credentials you enter (such as an app password or bot token).</li>
        <li>Content: the posts, captions, images and videos you create or upload, and your publishing schedule.</li>
        <li>Analytics: post and account metrics (such as views, likes, comments and followers) that we pull from the platforms you connect.</li>
        <li>Billing: your plan and payment status. Payments are handled by Dodo Payments; we never see or store your card number.</li>
        <li>Basic technical data needed to run the service, such as session cookies and request logs.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use your data only to provide the features you ask for: signing you in, publishing and scheduling your
        posts to the accounts you connected, showing you analytics for those posts, billing, and sending service
        emails (such as sign-in links and publishing failures). We do not sell your data and we do not use it for
        advertising.
      </p>

      <h2>How we protect it</h2>
      <p>
        OAuth tokens and platform credentials are encrypted at rest with AES, and the encryption keys are rotated.
        Data is sent over HTTPS. Only the code that publishes your posts or fetches your analytics decrypts tokens.
      </p>

      <h2>Service providers</h2>
      <p>We share data only with the providers that run parts of {name} for us:</p>
      <ul>
        <li>Cloudflare: hosting, and storage of uploaded media (Cloudflare R2).</li>
        <li>Neon: our Postgres database.</li>
        <li>Dodo Payments: payment processing and billing.</li>
        <li>Resend: sending email.</li>
        <li>Anthropic: only if you use the optional AI suggestions, the text of the post you ask about is sent to Anthropic to generate a suggestion.</li>
      </ul>
      <p>We also send your content to the social networks you choose, when you ask us to publish it there.</p>

      <h2>Google and YouTube data</h2>
      <p>
        {name}&apos;s use and transfer of information received from Google APIs to any other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including
        the Limited Use requirements.
      </p>
      <p>
        {name} uses YouTube API Services to upload videos to and read analytics from the YouTube channels you connect.
        By connecting YouTube you agree to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>, and
        Google&apos;s handling of your data is described in the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.
        You can revoke {name}&apos;s access at any time from your{" "}
        <a href="https://myaccount.google.com/permissions">Google security settings</a>.
      </p>

      <h2>Retention and deletion</h2>
      <ul>
        <li>Disconnecting an account in {name} deletes its stored tokens and credentials.</li>
        <li>Deleting your workspace deletes its connected accounts, tokens, posts, media and analytics.</li>
        <li>If you remove {name} from Instagram or Facebook, or ask Meta to delete your data, Meta notifies us and we delete the tokens and analytics we collected for that account.</li>
        <li>You can also revoke access from each platform&apos;s own settings; publishing to that account stops immediately.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can see, export, correct or delete your data. Most of this you can do yourself in the app; for anything
        else, contact us through the support option in the app.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy, we will update the date above and tell you in the app or by email when the change is significant.</p>

      <h2>Contact</h2>
      <p>For privacy questions or deletion requests, contact us through the support option in the app.</p>
    </LegalPage>
  );
}
