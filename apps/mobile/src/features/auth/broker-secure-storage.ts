type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** The SDK requires persistSession=true to use an adapter. Persist only PKCE,
 * never its access/refresh tokens: DABBOBA's canonical session has its own store. */
export function createBrokerSecureStorage(storageKey: string, secure: Storage): Storage {
  const transient = new Map<string, string>();
  const isVerifier = (key: string) => {
    if (key === `${storageKey}-code-verifier` || key === `${storageKey}-flows-code-verifier`) return true;
    const prefix = `${storageKey}-flow-`;
    const suffix = "-code-verifier";
    return key.startsWith(prefix) && key.endsWith(suffix)
      && /^[A-Za-z0-9_-]{8,64}$/.test(key.slice(prefix.length, -suffix.length));
  };
  return {
    getItem: async key => isVerifier(key) ? secure.getItem(key) : transient.get(key) ?? null,
    setItem: async (key, value) => {
      if (isVerifier(key)) await secure.setItem(key, value);
      else transient.set(key, value);
    },
    removeItem: async key => {
      if (isVerifier(key)) await secure.removeItem(key);
      else transient.delete(key);
    },
  };
}
