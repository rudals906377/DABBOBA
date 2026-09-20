export function catalogProductImageRequestId(
  uri: string | null,
  requestKey: string | number,
): string | null {
  return uri ? JSON.stringify([requestKey, uri]) : null;
}
