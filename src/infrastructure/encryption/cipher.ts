// AES-256-GCM via WebCrypto (identical on Workers and Node). Keyring supports rotation:
// TOKEN_ENC_KEYS="2:<base64 32B>,1:<base64 32B>"  -> first entry encrypts, all entries decrypt.
const b64 = {
  enc: (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url"),
  dec: (s: string) => new Uint8Array(Buffer.from(s, "base64url")),
};

export interface Cipher {
  /** Id of the key that new ciphertexts are written with. */
  readonly keyId: string;
  encrypt(plain: string, aad: string): Promise<string>;
  decrypt(blob: string, aad: string): Promise<string>;
}

export async function createCipher(spec: string): Promise<Cipher> {
  const entries = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("TOKEN_ENC_KEYS is empty");
  const keys = new Map<string, CryptoKey>();
  let currentId = "";
  for (const [i, e] of entries.entries()) {
    const sep = e.indexOf(":");
    const id = e.slice(0, sep);
    const raw = Buffer.from(e.slice(sep + 1), "base64");
    if (sep < 1 || !/^\w+$/.test(id) || raw.length !== 32) throw new Error("TOKEN_ENC_KEYS entries must look like <id>:<base64 of 32 bytes>");
    keys.set(id, await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
    if (i === 0) currentId = id;
  }
  const te = new TextEncoder();
  return {
    keyId: currentId,
    async encrypt(plain, aad) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, keys.get(currentId)!, te.encode(plain));
      return `${currentId}.${b64.enc(iv)}.${b64.enc(ct)}`;
    },
    async decrypt(blob, aad) {
      const [id, iv, ct] = blob.split(".");
      const key = id ? keys.get(id) : undefined;
      if (!key || !iv || !ct) throw new Error("Unrecognized ciphertext or unknown key id");
      // aad binds the ciphertext to its row: a blob copied to another account fails authentication.
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.dec(iv), additionalData: te.encode(aad) }, key, b64.dec(ct));
      return new TextDecoder().decode(pt);
    },
  };
}
