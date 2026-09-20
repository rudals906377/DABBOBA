export type ProfileResponseResult<T> = {
  data?: T;
  response: { status: number };
};

export function requireProfileResponse<T>(
  result: ProfileResponseResult<T>,
  createError: (status: number) => Error,
): T {
  if (result.data !== undefined && result.data !== null) return result.data;
  throw createError(result.response.status);
}

export function allowMissingProfileResponse<T>(
  result: ProfileResponseResult<T>,
  missingStatus: number,
  createError: (status: number) => Error,
): T | null {
  if (result.data !== undefined && result.data !== null) return result.data;
  if (result.response.status === missingStatus) return null;
  throw createError(result.response.status);
}
