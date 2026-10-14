function utf8Bytes(character: string): number {
  const codePoint = character.codePointAt(0)!;
  return codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
}

// UTF-8 is a conservative bound for KICC's documented EUC-KR byte limits.
// Buyer identity is rejected, never silently shortened.
export function paymentCustomerNameByteLimit(pgProvider?: string): number {
  return pgProvider === "KICC_V2" ? 20 : 30;
}

export function normalizedPaymentCustomerName(value: string, pgProvider?: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return null;
  let byteLength = 0;
  for (const character of name) {
    byteLength += utf8Bytes(character);
    if (byteLength > paymentCustomerNameByteLimit(pgProvider)) return null;
  }
  return name;
}

/** Only the PG display label is shortened; the server's order stays intact. */
export function normalizedPaymentOrderName(value: string, pgProvider?: string): string {
  const limit = pgProvider === "KICC_V2" ? 50 : 40;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(pgProvider === "NICE_V2" ? /[%&|$\-+=\[\]]/g : /\u0000/g, " ")
    .replace(/\s+/g, " ").trim();
  let bytes = 0;
  let name = "";
  for (const character of cleaned) {
    const size = utf8Bytes(character);
    if (bytes + size > limit) break;
    name += character;
    bytes += size;
  }
  return name.trim() || "다뽀바 상품";
}
