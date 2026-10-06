import { AppError } from "./errors.js";

/**
 * Pre-publication filter for customer-authored text that other users can see
 * (App Store Review Guideline 1.2). It is intentionally conservative: product,
 * character and work names share syllables with ordinary words, so precision
 * wins over recall and ambiguous terms are left out. Reports, user blocking
 * and operator moderation remain the backstop for anything this misses.
 *
 * Private text (support inquiries, report details, catalog requests, shipping
 * notes) must never be passed through this filter: a customer always has to be
 * able to describe a problem to the operator.
 */

export const CONTENT_NOT_ALLOWED_CODE = "CONTENT_NOT_ALLOWED";
export const CONTENT_NOT_ALLOWED_MESSAGE = "부적절한 표현이나 외부 연락처가 포함되어 등록할 수 없어요.";

export type ContentViolationKind = "OBJECTIONABLE" | "OFF_PLATFORM_CONTACT";

/**
 * - `PUBLIC_PROFILE`: nickname and bio; objectionable terms only.
 * - `COMMUNITY`: Dukroom posts and comments; objectionable terms only.
 * - `MARKETPLACE`: exchange-room and request-room text; objectionable terms plus
 *   off-platform contact (links, phone numbers, messenger-ID requests), because
 *   trades arranged outside the app lose DABBOBA's inventory locks.
 */
export type ContentFilterScope = "PUBLIC_PROFILE" | "COMMUNITY" | "MARKETPLACE";

type SevereTerm = {
  term: string;
  /**
   * `contains`: matches anywhere inside one normalized word.
   * `word`: Latin only; must equal a whole run of Latin letters, so
   * `Kinoshita`, `Scunthorpe`, `Essex` and `unisex` stay allowed.
   */
  match: "contains" | "word";
  /** Syllables that turn a `contains` match into an ordinary compound word. */
  unlessFollowedBy?: string;
  /** Extra whole-word inflections for a `word` term. */
  forms?: readonly string[];
};

// Category A: a small, well-known list of severe Korean/English profanity,
// sexually explicit and hateful slur terms. Keep it short and unambiguous;
// for example 보지/자지 are omitted because `보지 못했어요` and `자지러지다`
// are everyday Korean, and `시발` ignores `시발점`, `다시발매`, `출시발표`.
const SEVERE_TERMS: readonly SevereTerm[] = [
  { term: "씨발", match: "contains" },
  { term: "시발", match: "contains", unlessFollowedBy: "점역차택매표송견생급행전효령주명동달굴" },
  { term: "씨팔", match: "contains" },
  { term: "씨빨", match: "contains" },
  { term: "ㅅㅂ", match: "contains" },
  { term: "ㅆㅂ", match: "contains" },
  { term: "병신", match: "contains" },
  { term: "ㅄ", match: "contains" },
  { term: "좆", match: "contains" },
  { term: "개새끼", match: "contains" },
  { term: "개색끼", match: "contains" },
  { term: "섹스", match: "contains" },
  { term: "창녀", match: "contains" },
  { term: "니애미", match: "contains" },
  { term: "느금마", match: "contains" },
  { term: "엠창", match: "contains" },
  { term: "쪽바리", match: "contains" },
  { term: "쪽발이", match: "contains" },
  { term: "짱깨", match: "contains" },
  { term: "깜둥이", match: "contains" },
  { term: "fuck", match: "contains" },
  { term: "shit", match: "word", forms: ["shits", "shitty", "bullshit", "horseshit"] },
  { term: "cunt", match: "word", forms: ["cunts"] },
  { term: "nigger", match: "word", forms: ["niggers"] },
  { term: "nigga", match: "word", forms: ["niggas"] },
  { term: "faggot", match: "word", forms: ["faggots"] },
  { term: "bitch", match: "word", forms: ["bitches"] },
  { term: "whore", match: "word", forms: ["whores"] },
  { term: "slut", match: "word", forms: ["sluts"] },
  { term: "sex", match: "word" },
  { term: "porn", match: "word", forms: ["porno"] },
];

export const SEVERE_TERM_COUNT = SEVERE_TERMS.length;

// Format and zero-width characters (soft hyphen, ZWSP/ZWNJ/ZWJ, bidi marks,
// word joiners, variation selectors, BOM and Hangul fillers) used to split words invisibly.
const INVISIBLE_CHARACTERS =
  /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/gu;
// ASCII punctuation (`.`, `-`, `_`, `*`, quotes, slashes ...) and common middle dots.
const SEPARATORS = /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u00b7\u2022\u2027\u2219\u30fb]/gu;
const LATIN_RUN = /[a-z]+/gu;

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(INVISIBLE_CHARACTERS, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const containsPatterns = SEVERE_TERMS
  .filter((entry) => entry.match === "contains")
  .map((entry) => {
    const term = escapeRegExp(entry.term.normalize("NFKC"));
    const guard = entry.unlessFollowedBy ? `(?![${entry.unlessFollowedBy}])` : "";
    return new RegExp(`${term}${guard}`, "u");
  });
const latinWords = new Set(
  SEVERE_TERMS
    .filter((entry) => entry.match === "word")
    .flatMap((entry) => [entry.term, ...(entry.forms ?? [])]),
);

/**
 * Splits text into comparison words. Separators inside a word are removed
 * (`s.e.x`, `시*발`, `f-u-c-k`), and runs of single-character fragments are
 * joined (`시 발`, `s e x`). Whitespace between ordinary multi-character words
 * is preserved so `다시 발매` or `push it` never merge into a false positive.
 */
export function contentFilterWords(value: string): string[] {
  const fragments = normalized(value)
    .split(/\s+/u)
    .map((fragment) => fragment.replace(SEPARATORS, ""))
    .filter((fragment) => fragment.length > 0);
  const words: string[] = [];
  let spelledOut = "";
  for (const fragment of fragments) {
    if (Array.from(fragment).length === 1) {
      spelledOut += fragment;
      continue;
    }
    if (spelledOut) words.push(spelledOut);
    spelledOut = "";
    words.push(fragment);
  }
  if (spelledOut) words.push(spelledOut);
  return words;
}

function containsObjectionableTerm(value: string): boolean {
  for (const word of contentFilterWords(value)) {
    if (containsPatterns.some((pattern) => pattern.test(word))) return true;
    for (const latin of word.match(LATIN_RUN) ?? []) {
      if (latinWords.has(latin)) return true;
    }
  }
  return false;
}

// Category B: links, phone numbers and explicit requests to continue on a messenger.
const TOP_LEVEL_DOMAINS = [
  "com", "net", "org", "kr", "co", "io", "me", "ly", "gl", "gg", "to", "tv", "be", "so", "im",
  "do", "ai", "jp", "cn", "us", "cc", "ws", "pw", "kakao", "link", "app", "xyz", "shop", "store",
  "site", "info", "biz", "asia",
];
const URL_PATTERNS: readonly RegExp[] = [
  /https?:\/\//u,
  /(?<![a-z0-9])www\./u,
  new RegExp(
    `(?<![a-z0-9-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TOP_LEVEL_DOMAINS.join("|")})(?![a-z0-9])`,
    "u",
  ),
  // `naver . com` style spacing around the dot, limited to common domains.
  /(?<![a-z0-9-])[a-z][a-z0-9-]{1,62}(?:\s*\.\s*[a-z0-9-]{1,63})*\s*\.\s*(?:com|net|org|kr)(?![a-z0-9])/u,
  /@(?:naver|gmail|daum|hanmail|kakao|nate|icloud|hotmail|outlook|yahoo)(?![a-z])/u,
];
const DIGIT_SEPARATORS = /(?<=\d)[\s.\-_()\u00b7\u2022\u2027\u2219]+(?=\d)/gu;
const PHONE_PATTERNS: readonly RegExp[] = [
  // Korean mobile numbers and any 10–11 digit run starting with 01, in any separator form.
  /(?<!\d)01\d{8,9}(?!\d)/u,
  /\+820?1\d{8,9}(?!\d)/u,
];
const MESSENGER = "카톡|카카오톡|kakaotalk|katalk|텔레그램|telegram|디스코드|discord|디코|인스타그램|인스타|instagram|insta|위챗|wechat";
// Matched against both a compact form (no spaces or separators) and a spaced
// form (separators turned into single spaces) so `카톡 아이디` and
// `카카오톡 id: abc` match while `guideline identity` and `라인 아이디어` do not.
const CONTACT_PHRASE_PATTERNS: readonly RegExp[] = [
  /오픈채팅|오픈챗|오픈카톡|오픈톡|오카방|openchat|openkakao|opentalk/u,
  new RegExp(`(?:${MESSENGER}|카카오|kakao|텔레|라인|line|snapchat|스냅챗) ?(?:아이디(?!어)|아디(?!다)|id(?![a-z]))`, "u"),
  new RegExp(
    `(?:${MESSENGER})(?:으로|로)?(?:연락|문의|친추|친구추가|추가|dm|디엠|주세요|줘요|주시|해주세요|주면|드릴게|드려요|보내|남겨)`,
    "u",
  ),
  /(?:연락처|전화번호|폰번호|핸드폰번호|휴대폰번호|휴대전화번호)(?:를|을)?(?:남겨|알려|주세요|줘요|주시|드릴게|드려요|공유|보내)/u,
  /(?<![a-z])(?:dm|디엠)(?:으로|로)?(?:주세요|줘요|주시|보내|부탁|연락)/u,
];

function containsOffPlatformContact(value: string): boolean {
  const base = normalized(value);
  if (URL_PATTERNS.some((pattern) => pattern.test(base))) return true;
  const digits = base.replace(DIGIT_SEPARATORS, "");
  if (PHONE_PATTERNS.some((pattern) => pattern.test(digits))) return true;
  const compact = base.replace(/\s+/gu, "").replace(SEPARATORS, "");
  const spaced = base.replace(SEPARATORS, " ").replace(/\s+/gu, " ");
  return CONTACT_PHRASE_PATTERNS.some((pattern) => pattern.test(compact) || pattern.test(spaced));
}

/** Returns the first violation kind for one text value, or null when it may be published. */
export function findContentViolation(
  value: string | null | undefined,
  scope: ContentFilterScope,
): ContentViolationKind | null {
  if (!value) return null;
  if (containsObjectionableTerm(value)) return "OBJECTIONABLE";
  if (scope === "MARKETPLACE" && containsOffPlatformContact(value)) return "OFF_PLATFORM_CONTACT";
  return null;
}

export function contentNotAllowed(): AppError {
  return new AppError(400, CONTENT_NOT_ALLOWED_CODE, CONTENT_NOT_ALLOWED_MESSAGE);
}

/**
 * Throws `CONTENT_NOT_ALLOWED` (400) when any public field violates the scope.
 * The response never says which field or word matched. Call it after input
 * parsing and before any database work.
 */
export function assertPublicContentAllowed(
  scope: ContentFilterScope,
  ...values: ReadonlyArray<string | null | undefined>
): void {
  for (const value of values) {
    if (findContentViolation(value, scope)) throw contentNotAllowed();
  }
}
