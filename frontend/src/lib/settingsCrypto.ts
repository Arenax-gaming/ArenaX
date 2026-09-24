"use client";

/**
 * Settings backup encryption helpers.
 *
 * Exported files use the versioned envelope below:
 *
 *   arenax:enc:v1:<base64url(salt)>.<base64url(iv)>.<base64url(ciphertext+tag)>
 *
 * The payload is the same JSON used for the plain backup, encrypted with
 * AES-256-GCM. The key is derived from the user's passphrase with PBKDF2
 * (SHA-256, 210k iterations) and a random per-export salt, so re-exporting
 * with the same passphrase always produces different ciphertext.
 */

export const ENCRYPTED_SETTINGS_MARKER = "arenax:enc:v1:";

export const PBKDF2_ITERATIONS = 210_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  operations: KeyUsage[],
): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(passphrase);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoded,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    operations,
  );
}

/** True when the string is an encrypted settings backup (starts with the marker). */
export function isEncryptedSettingsExport(data: string): boolean {
  return typeof data === "string" && data.startsWith(ENCRYPTED_SETTINGS_MARKER);
}

/** Encrypt raw settings JSON into the versioned envelope. */
export async function encryptSettingsText(
  plaintext: string,
  passphrase: string,
): Promise<string> {
  if (!passphrase) {
    throw new Error("A passphrase is required to encrypt settings.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, ["encrypt"]);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  const parts = [
    bytesToBase64(salt),
    bytesToBase64(iv),
    bytesToBase64(new Uint8Array(ciphertext)),
  ];
  return ENCRYPTED_SETTINGS_MARKER + parts.join(".");
}

/**
 * Decrypt an encrypted settings backup. Throws when the file is not an
 * encrypted backup or the passphrase is wrong.
 */
export async function decryptSettingsText(
  encrypted: string,
  passphrase: string,
): Promise<string> {
  if (!isEncryptedSettingsExport(encrypted)) {
    throw new Error("This file is not an encrypted ArenaX settings backup.");
  }
  if (!passphrase) {
    throw new Error("A passphrase is required to decrypt settings.");
  }

  const [saltB64, ivB64, dataB64] = encrypted
    .slice(ENCRYPTED_SETTINGS_MARKER.length)
    .split(".");

  if (!saltB64 || !ivB64 || !dataB64) {
    throw new Error("Malformed encrypted settings backup.");
  }

  const key = await deriveKey(passphrase, base64ToBytes(saltB64), ["decrypt"]);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivB64) },
    key,
    base64ToBytes(dataB64),
  );

  return new TextDecoder().decode(plaintext);
}