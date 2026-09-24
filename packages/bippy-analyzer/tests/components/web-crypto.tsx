import { useEffect, useState } from "react";

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

interface CryptoFacts {
  sha256: string;
  ivLength: number;
  ciphertextLength: number;
  roundTrip: string;
  keyType: string;
  uuidLength: number;
}

const gatherFacts = async (): Promise<CryptoFacts> => {
  const encoder = new TextEncoder();
  const sha256 = toHex(await crypto.subtle.digest("SHA-256", encoder.encode("hello")));
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode("secret message"),
  );
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return {
    sha256,
    ivLength: iv.length,
    ciphertextLength: ciphertext.byteLength,
    roundTrip: new TextDecoder().decode(plaintext),
    keyType: key.type,
    uuidLength: crypto.randomUUID().length,
  };
};

const WebCrypto = () => {
  const [facts, setFacts] = useState<CryptoFacts | null>(null);
  useEffect(() => {
    void gatherFacts().then(setFacts);
  }, []);
  if (!facts) return <p>hashing</p>;
  return (
    <dl>
      <dt>sha256</dt>
      <dd>hex {facts.sha256}</dd>
      <dt>iv</dt>
      <dd>{facts.ivLength} bytes</dd>
      <dt>ciphertext</dt>
      <dd>{facts.ciphertextLength} bytes</dd>
      <dt>round trip</dt>
      <dd>says {facts.roundTrip}</dd>
      <dt>key</dt>
      <dd>type {facts.keyType}</dd>
      <dt>uuid</dt>
      <dd>{facts.uuidLength} chars</dd>
    </dl>
  );
};

export default WebCrypto;
