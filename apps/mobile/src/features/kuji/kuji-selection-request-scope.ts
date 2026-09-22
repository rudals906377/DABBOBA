/** A mounted background route must never apply an old request to the foreground route. */
export function createKujiSelectionRequestScope() {
  let ownerKey = "";
  let focused = false;
  let generation = 0;

  const capture = () => {
    const requestGeneration = generation;
    return () => focused && generation === requestGeneration;
  };

  return {
    setOwner(nextOwnerKey: string) {
      if (ownerKey === nextOwnerKey) return;
      ownerKey = nextOwnerKey;
      focused = false;
      generation += 1;
    },
    focus() { focused = true; },
    invalidate() {
      focused = false;
      generation += 1;
    },
    isFocused() { return focused; },
    beginRequest() {
      generation += 1;
      return capture();
    },
    captureCurrentRequest: capture,
  };
}
