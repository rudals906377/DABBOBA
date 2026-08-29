const TITLE_SEPARATOR = /^[\s·:：\-–—|/]+|[\s·:：\-–—|/]+$/g;

export function productSubjectTitle(productName: string, ipName?: string | null): string {
  const normalizedProductName = compactWhitespace(productName);
  const normalizedIpName = compactWhitespace(ipName ?? "");
  if (!normalizedIpName) return normalizedProductName;

  const ipIndex = normalizedProductName.indexOf(normalizedIpName);
  if (ipIndex < 0) return normalizedProductName;

  const subject = compactWhitespace(
    `${normalizedProductName.slice(0, ipIndex)} ${normalizedProductName.slice(ipIndex + normalizedIpName.length)}`,
  ).replace(TITLE_SEPARATOR, "");

  return subject || normalizedProductName;
}

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
