type AsyncStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export function createPkceOnlyStorage(storageKey: string, backing: AsyncStorage): AsyncStorage {
  const isPkceKey = (key: string) => key.startsWith(`${storageKey}-`) && key.endsWith("-code-verifier");
  return {
    getItem: (key) => isPkceKey(key) ? backing.getItem(key) : Promise.resolve(null),
    setItem: (key, value) => isPkceKey(key) ? backing.setItem(key, value) : Promise.resolve(),
    removeItem: (key) => isPkceKey(key) ? backing.removeItem(key) : Promise.resolve(),
  };
}
