import { randomBytes, scrypt as nodeScrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

export const PASSWORD_PARAMETERS = { cost: 16_384, blockSize: 8, parallelization: 1, keyLength: 64 } as const;

type DeriveParameters = {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
};

export type PasswordRecord = {
  hash: string;
  salt: string;
  cost: number;
  blockSize: number;
  parallelization: number;
};

function scryptAsync(password: string, salt: string, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function derive(password: string, salt: string, record: DeriveParameters = PASSWORD_PARAMETERS): Promise<Buffer> {
  return scryptAsync(password.normalize("NFKC"), salt, record.keyLength, {
    N: record.cost,
    r: record.blockSize,
    p: record.parallelization,
    maxmem: 64 * 1024 * 1024,
  });
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(24).toString("base64url");
  const hash = await derive(password, salt);
  return {
    hash: hash.toString("base64url"),
    salt,
    cost: PASSWORD_PARAMETERS.cost,
    blockSize: PASSWORD_PARAMETERS.blockSize,
    parallelization: PASSWORD_PARAMETERS.parallelization,
  };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const actual = await derive(password, record.salt, {
    keyLength: Buffer.from(record.hash, "base64url").length,
    cost: record.cost,
    blockSize: record.blockSize,
    parallelization: record.parallelization,
  });
  const expected = Buffer.from(record.hash, "base64url");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
