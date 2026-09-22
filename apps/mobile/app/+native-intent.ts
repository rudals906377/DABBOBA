export const MAX_SYSTEM_PATH_LENGTH = 4096;

type RedirectSystemPathOptions = {
  path: string;
  initial: boolean;
};

export function redirectSystemPath({ path, initial }: RedirectSystemPathOptions): string | null {
  const rejectedPath = initial ? "/" : null;

  try {
    if (typeof path !== "string" || path.length > MAX_SYSTEM_PATH_LENGTH) {
      return rejectedPath;
    }

    // This bounded native-entry validation mitigates the transitive
    // decode-uri-component advisory; it does not remove the audit finding.
    decodeURIComponent(path);
    return path;
  } catch {
    return rejectedPath;
  }
}
