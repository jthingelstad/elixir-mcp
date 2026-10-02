/** Private authenticated encryption. The default model-key domain keeps
 * existing boxes readable; bridge payloads use a different derived key. */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
export function createBox(secret, purpose) {
  if (!secret || !purpose)
    throw new Error("private sealing needs a secret and domain");
  const key = Buffer.from(
    hkdfSync("sha256", secret, "elixir-clan", purpose, 32),
  );
  return {
    seal(plain, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return {
        v: 1,
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ct: ct.toString("base64"),
      };
    },
    open(box, aad) {
      try {
        if (box?.v !== 1) return null;
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(box.iv, "base64"),
        );
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(Buffer.from(box.tag, "base64"));
        return Buffer.concat([
          decipher.update(Buffer.from(box.ct, "base64")),
          decipher.final(),
        ]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}
