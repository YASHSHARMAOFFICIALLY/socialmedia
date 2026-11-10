import { describe, it, expect } from "vitest";
import { createCipher } from "../src/infrastructure/encryption/cipher.js";

const k = (n: number) => Buffer.alloc(32, n).toString("base64");

describe("token cipher (AES-256-GCM)", () => {
  it("round-trips and never emits plaintext", async () => {
    const c = await createCipher(`1:${k(1)}`);
    const blob = await c.encrypt("super-secret-token", "row:1");
    expect(blob).not.toContain("super-secret-token");
    expect(await c.decrypt(blob, "row:1")).toBe("super-secret-token");
  });
  it("uses a fresh IV per encryption", async () => {
    const c = await createCipher(`1:${k(1)}`);
    expect(await c.encrypt("x", "a")).not.toBe(await c.encrypt("x", "a"));
  });
  it("rejects tampering and wrong AAD (blob copied to another row)", async () => {
    const c = await createCipher(`1:${k(1)}`);
    const blob = await c.encrypt("tok", "row:1");
    await expect(c.decrypt(blob, "row:2")).rejects.toThrow();
    const [id, iv, ct] = blob.split(".");
    await expect(c.decrypt(`${id}.${iv}.${ct!.slice(0, -2)}AA`, "row:1")).rejects.toThrow();
  });
  it("supports key rotation: new key encrypts, old key still decrypts", async () => {
    const old = await createCipher(`1:${k(1)}`);
    const blob = await old.encrypt("tok", "r");
    const rotated = await createCipher(`2:${k(2)},1:${k(1)}`);
    expect(await rotated.decrypt(blob, "r")).toBe("tok");
    expect((await rotated.encrypt("tok", "r")).startsWith("2.")).toBe(true);
    const withoutOld = await createCipher(`2:${k(2)}`);
    await expect(withoutOld.decrypt(blob, "r")).rejects.toThrow(/key id/);
  });
  it("validates key material", async () => {
    await expect(createCipher("1:c2hvcnQ=")).rejects.toThrow(/32 bytes/);
    await expect(createCipher("")).rejects.toThrow();
  });
});
