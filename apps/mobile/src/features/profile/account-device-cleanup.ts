/** Keep the current identity in place until all previous-customer local data is gone. */
export async function clearAccountDeviceState(steps: {
  clearLocalData: () => Promise<void>;
  clearBrokerSession: () => Promise<void>;
  clearAuthTokens: () => Promise<void>;
}): Promise<void> {
  await steps.clearLocalData();
  await steps.clearBrokerSession();
  await steps.clearAuthTokens();
}

/** Never expose a new customer's session to data left by the previous one. */
export async function commitAccountSessionAfterCleanup(steps: {
  clearLocalData: () => Promise<void>;
  writeAuthTokens: () => Promise<void>;
}): Promise<void> {
  await steps.clearLocalData();
  await steps.writeAuthTokens();
}
