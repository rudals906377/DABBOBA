import type { DatabaseClient } from "@dabboba/db";

export const MOBILE_TEST_EMAIL = "mobile-test@dabboba.local";

const FIXTURE_KEY = "mobile-test-account-v2";
const FIXTURE_POINT_REFERENCE = `${FIXTURE_KEY}:welcome-points`;
const FIXTURE_POINT_AMOUNT = 3_000;

export function developmentSessionEnabled(input: {
  environment: "development" | "test" | "production";
  explicitFlag?: string | undefined;
}): boolean {
  return input.environment === "test"
    || (input.environment === "development" && input.explicitFlag === "true");
}

export function mobileTestFixturesEnabled(input: {
  environment: "development" | "test" | "production";
  databaseUrl: string;
  explicitFlag?: string | undefined;
  expectedProjectRef?: string | undefined;
}): boolean {
  if (input.environment === "production" || input.explicitFlag !== "true") return false;
  const expected = input.expectedProjectRef?.trim();
  if (!expected) return false;
  try {
    const database = new URL(input.databaseUrl);
    if (expected === "local") {
      return ["127.0.0.1", "localhost", "::1"].includes(database.hostname)
        && database.pathname === "/dabboba";
    }
    const sessionPoolerMatches = database.hostname.endsWith(".supabase.com")
      && database.username.split(".").at(-1) === expected;
    const directConnectionMatches = database.hostname === `db.${expected}.supabase.co`;
    return sessionPoolerMatches || directConnectionMatches;
  } catch {
    return false;
  }
}

export async function provisionMobileTestAccount(
  client: DatabaseClient,
  input: { userId: string; email: string },
): Promise<void> {
  if (input.email !== MOBILE_TEST_EMAIL) return;

  await client.query(
    `INSERT INTO default_shipping_addresses(
       user_id,recipient,phone,postal_code,address_line1,address_line2,delivery_note
     ) VALUES($1,'테스트 사용자','01000000000','10888','경기도 파주시 테스트로 1','개발 전용 배송지','개발 테스트 계정입니다')
     ON CONFLICT (user_id) DO NOTHING`,
    [input.userId],
  );

  await client.query(
    "INSERT INTO point_accounts(user_id,balance) VALUES($1,0) ON CONFLICT (user_id) DO NOTHING",
    [input.userId],
  );
  const inserted = await client.query(
    `INSERT INTO point_ledger_entries(
       user_id,entry_type,amount,reference_type,reference_id,reason
     ) VALUES($1,'EARN',$2,'DEVELOPMENT_FIXTURE',$3,'테스트 계정 시작 포인트')
     ON CONFLICT (user_id,entry_type,reference_type,reference_id) DO NOTHING
     RETURNING id`,
    [input.userId, FIXTURE_POINT_AMOUNT, FIXTURE_POINT_REFERENCE],
  );
  if (inserted.rowCount) {
    await client.query(
      "UPDATE point_accounts SET balance=balance+$2,version=version+1 WHERE user_id=$1",
      [input.userId, FIXTURE_POINT_AMOUNT],
    );
  }
}
