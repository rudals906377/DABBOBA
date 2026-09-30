/** PortOne/KG INICIS requires a purchaser name of at most 30 UTF-8 bytes. */
export function normalizedPaymentCustomerName(value: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return null;
  let byteLength = 0;
  for (const character of name) {
    const codePoint = character.codePointAt(0)!;
    byteLength += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (byteLength > 30) return null;
  }
  return name;
}
