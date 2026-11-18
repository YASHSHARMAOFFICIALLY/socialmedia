import { describe, it, expect } from "vitest";
import { microsoftUser } from "../src/modules/auth/auth.js";

const CONSUMER = "9188040d-6c67-4c5b-b112-36a304b66dad";

describe("microsoft profile mapping", () => {
  it("trusts the email of personal accounts (Outlook/Hotmail), so they can sign in to an existing account", () => {
    expect(microsoftUser({ tid: CONSUMER, email: "a@hotmail.com" })).toEqual({ email: "a@hotmail.com", emailVerified: true });
  });
  it("falls back to preferred_username when a personal account sends no email claim", () => {
    expect(microsoftUser({ tid: CONSUMER, preferred_username: "b@outlook.com" })).toEqual({ email: "b@outlook.com", emailVerified: true });
  });
  it("never trusts work/school tenant emails (admins can set any address)", () => {
    expect(microsoftUser({ tid: "some-company-tenant", email: "ceo@victim.com", preferred_username: "x@evil.com" })).toEqual({});
  });
  it("ignores a phone-number username", () => {
    expect(microsoftUser({ tid: CONSUMER, preferred_username: "+15551234567" })).toEqual({});
  });
});
