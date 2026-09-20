import { badRequest } from "./errors.js";

export function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest();
  return value as Record<string, unknown>;
}

export function assertOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw badRequest("허용되지 않은 입력값이 포함되어 있습니다.");
  }
}

export function stringInput(
  input: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; optional?: boolean; trim?: boolean } = {},
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    if (options.optional) return undefined;
    throw badRequest(`${key} 값이 필요합니다.`);
  }
  if (typeof value !== "string") throw badRequest(`${key} 값은 문자열이어야 합니다.`);
  const normalized = options.trim === false ? value : value.trim();
  if (normalized.length < (options.min ?? 1) || normalized.length > (options.max ?? 10_000)) {
    throw badRequest(`${key} 길이를 확인해 주세요.`);
  }
  return normalized;
}

export function nullableStringInput(
  input: Record<string, unknown>,
  key: string,
  options: { max?: number; trim?: boolean } = {},
): string | null | undefined {
  if (!(key in input)) return undefined;
  if (input[key] === null || input[key] === "") return null;
  return stringInput(input, key, {
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.trim === undefined ? {} : { trim: options.trim }),
  });
}

export function booleanInput(input: Record<string, unknown>, key: string, optional = false): boolean | undefined {
  const value = input[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "boolean") throw badRequest(`${key} 값은 boolean이어야 합니다.`);
  return value;
}

export function integerInput(
  input: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
): number | undefined {
  const value = input[key];
  if (value === undefined && options.optional) return undefined;
  if (!Number.isInteger(value)) throw badRequest(`${key} 값은 정수여야 합니다.`);
  const number = value as number;
  if (number < (options.min ?? Number.MIN_SAFE_INTEGER) || number > (options.max ?? Number.MAX_SAFE_INTEGER)) {
    throw badRequest(`${key} 범위를 확인해 주세요.`);
  }
  return number;
}

export function enumInput<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  optional = false,
): T | undefined {
  const value = input[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw badRequest(`${key} 값을 확인해 주세요.`);
  return value as T;
}

export function stringArrayInput(input: Record<string, unknown>, key: string, maximum: number, optional = false): string[] | undefined {
  const value = input[key];
  if (value === undefined && optional) return undefined;
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string")) {
    throw badRequest(`${key} 값을 확인해 주세요.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function uuidInput(value: unknown, label = "id"): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw badRequest(`${label} 형식을 확인해 주세요.`);
  }
  return value;
}

export function slugIdInput(value: unknown, label = "id"): string {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 120) {
    throw badRequest(`${label} 형식을 확인해 주세요.`);
  }
  return value;
}

export function queryString(value: unknown, maximum = 120): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maximum) throw badRequest("검색 값을 확인해 주세요.");
  return value.trim() || undefined;
}
