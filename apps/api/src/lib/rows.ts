export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function nullableIso(value: Date | string | null): string | null {
  return value ? iso(value) : null;
}

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

export function maskIp(value: string | null): string | null {
  if (!value) return null;
  if (value.includes(":")) return `${value.split(":").slice(0, 3).join(":")}:…`;
  const parts = value.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.*.*` : null;
}

export function browserLabel(value: string | null): string | null {
  if (!value) return null;
  if (/undici|node\.js/i.test(value)) return "관리자 BFF · 최종 브라우저 미확인";
  const browser = /Edg\/(\d+)/.exec(value)?.[1]
    ? `Edge ${/Edg\/(\d+)/.exec(value)![1]}`
    : /Chrome\/(\d+)/.exec(value)?.[1]
      ? `Chrome ${/Chrome\/(\d+)/.exec(value)![1]}`
      : /Firefox\/(\d+)/.exec(value)?.[1]
        ? `Firefox ${/Firefox\/(\d+)/.exec(value)![1]}`
        : /Version\/(\d+).+Safari\//.exec(value)?.[1]
          ? `Safari ${/Version\/(\d+).+Safari\//.exec(value)![1]}`
          : "기타 브라우저";
  const platform = /Android/.test(value) ? "Android"
    : /iPhone|iPad|iPod/.test(value) ? "iOS/iPadOS"
      : /Macintosh|Mac OS X/.test(value) ? "macOS"
        : /Windows/.test(value) ? "Windows"
          : /Linux/.test(value) ? "Linux"
            : "기타 OS";
  return `${browser} · ${platform}`;
}

export function numberValue(value: number | string | bigint | null | undefined): number {
  return Number(value || 0);
}
