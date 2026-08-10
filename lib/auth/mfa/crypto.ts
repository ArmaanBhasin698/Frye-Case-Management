import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * All MFA secret material (TOTP secrets at rest, and the signature over the
 * challenge-ticket references held in cookies) is derived from a single
 * MFA_ENCRYPTION_KEY via HKDF into two purpose-scoped subkeys, rather than
 * using that key directly or reusing AUTH_SECRET — key separation from
 * session signing, and from each other, so rotating one never requires
 * rotating the others. See .env.example.
 */

const ENCRYPTION_INFO = "frye-mfa-totp-secret-encryption-v1";
const SIGNING_INFO = "frye-mfa-ticket-signing-v1";
const KEY_LENGTH = 32;

let cachedKeys: { encryptionKey: Buffer; signingKey: Buffer } | null = null;

function deriveKeys(): { encryptionKey: Buffer; signingKey: Buffer } {
  if (cachedKeys) return cachedKeys;

  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MFA_ENCRYPTION_KEY is not set. It is required before any TOTP enrollment, login challenge, or " +
        "recovery-code operation can run — see .env.example.",
    );
  }

  const ikm = Buffer.from(raw, "base64");
  if (ikm.length < KEY_LENGTH) {
    throw new Error(
      "MFA_ENCRYPTION_KEY must decode to at least 32 bytes. Generate one with: openssl rand -base64 32",
    );
  }

  cachedKeys = {
    encryptionKey: Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), ENCRYPTION_INFO, KEY_LENGTH)),
    signingKey: Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), SIGNING_INFO, KEY_LENGTH)),
  };
  return cachedKeys;
}

/** AES-256-GCM encrypts a TOTP secret for User.totpSecretEncrypted. */
export function encryptSecret(plaintext: string): string {
  const { encryptionKey } = deriveKeys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(":");
}

export function decryptSecret(stored: string): string {
  const { encryptionKey } = deriveKeys();
  const [ivB64, authTagB64, ciphertextB64] = stored.split(":");
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error("Malformed encrypted TOTP secret.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Signs an MfaChallengeTicket id for the reference cookie the browser holds. */
export function signTicketId(ticketId: string): string {
  const { signingKey } = deriveKeys();
  return createHmac("sha256", signingKey).update(ticketId).digest("base64url");
}

export function verifyTicketSignature(ticketId: string, signature: string): boolean {
  const expected = Buffer.from(signTicketId(ticketId));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
