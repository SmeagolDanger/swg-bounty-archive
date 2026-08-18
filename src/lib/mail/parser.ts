import { createHash } from "node:crypto";

// Parser for SWG /mailsave files. The format is stable across emulators:
//
//   <mail id>
//   FROM: SWG.<Galaxy>.auctioner        (or a player/system name)
//   SUBJECT: Vendor Sale Complete
//   TIMESTAMP: 1755468000               (unix seconds)
//   <blank line>
//   <body...>
//
// Sale bodies (vendor and bazaar) follow the classic auction templates:
//   Vendor: "Vendor: <vendor> has sold <item> to <buyer> for <n> credits."
//   Bazaar: "Your auction of <item> has been sold to <buyer> for <n> credits"
// Every uploaded mail is archived raw, so this parser can be revised and
// re-run over history at any time — parse failures never lose data.

export const MAIL_PARSER_VERSION = "1.3.0";

export interface ParsedMail {
  fingerprint: string;
  mailId: string;
  sender: string;
  subject: string;
  sentAt: Date | null;
  body: string;
}

export interface ParsedSale {
  itemName: string;
  buyer: string;
  credits: number;
  vendor: string;
  saleType: "vendor" | "bazaar";
}

// Unix stamp in seconds or milliseconds; anything else is not a date.
function timestampFrom(value: string): Date | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric > 1e12 ? numeric : numeric * 1_000);
}

export function mailFingerprint(raw: string): string {
  return createHash("sha256").update(raw.replace(/\r\n/g, "\n")).digest("hex");
}

export function parseMail(raw: string): ParsedMail {
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  let mailId = "";
  let sender = "";
  let subject = "";
  let sentAt: Date | null = null;
  let bodyStart = 0;
  let positional = 0; // count of unprefixed header lines consumed

  for (let index = 0; index < Math.min(lines.length, 8); index += 1) {
    const line = lines[index];
    if (index === 0 && /^\d+$/.test(line.trim())) {
      mailId = line.trim();
      bodyStart = index + 1;
      continue;
    }
    const header = /^([A-Za-z]+):\s?(.*)$/.exec(line);
    if (header && ["FROM", "SUBJECT", "TIMESTAMP"].includes(header[1].toUpperCase())) {
      const [, key, value] = header;
      if (key.toUpperCase() === "FROM") sender = value.trim();
      else if (key.toUpperCase() === "SUBJECT") subject = value.trim();
      else if (sentAt === null) sentAt = timestampFrom(value.trim());
      bodyStart = index + 1;
      continue;
    }
    // Positional timestamp: some /mailsave variants write the unix stamp as
    // a bare number line after sender and subject, with no prefix at all.
    if (sentAt === null && index > 0 && (sender !== "" || subject !== "") && /^\d{9,13}$/.test(line.trim())) {
      sentAt = timestampFrom(line.trim());
      bodyStart = index + 1;
      continue;
    }
    if (line.trim() === "" && bodyStart > 0) {
      bodyStart = index + 1;
      break;
    }
    // The live /mailsave format is positional: after the numeric id, the
    // next two lines are sender then subject with no prefixes.
    if (sentAt === null && positional < 2 && line.trim() !== "") {
      if (positional === 0 && sender === "") sender = line.trim();
      else if (subject === "") subject = line.trim();
      positional += 1;
      bodyStart = index + 1;
      continue;
    }
    if (bodyStart > 0) break;
  }

  return {
    fingerprint: mailFingerprint(raw),
    mailId,
    sender,
    subject,
    sentAt,
    body: lines.slice(bodyStart).join("\n").trim(),
  };
}

const CREDITS = String.raw`(?<credits>[\d,]+)\s+credits?`;

const VENDOR_PATTERNS = [
  // "Vendor: Hangar Nine has sold [Mark V Reactor] to Wrollo for 250,000 credits."
  new RegExp(String.raw`Vendor:\s*(?<vendor>.+?)\s+has sold\s+(?<item>.+?)\s+to\s+(?<buyer>.+?)\s+for\s+${CREDITS}`, "i"),
  // "Your vendor Hangar Nine has sold Mark V Reactor to Wrollo for 250000 credits"
  new RegExp(String.raw`Your vendor\s+(?<vendor>.+?)\s+has sold\s+(?<item>.+?)\s+to\s+(?<buyer>.+?)\s+for\s+${CREDITS}`, "i"),
];

const BAZAAR_PATTERNS = [
  // "Your auction of Mark V Reactor has been sold to Wrollo for 250000 credits"
  new RegExp(String.raw`Your auction of\s+(?<item>.+?)\s+has been sold to\s+(?<buyer>.+?)\s+for\s+${CREDITS}`, "i"),
];

export function parseSale(mail: ParsedMail): ParsedSale | null {
  const haystack = `${mail.subject}\n${mail.body}`;
  for (const pattern of VENDOR_PATTERNS) {
    const match = pattern.exec(haystack);
    if (match?.groups) {
      return {
        vendor: cleanName(match.groups.vendor),
        itemName: cleanName(match.groups.item),
        buyer: cleanName(match.groups.buyer),
        credits: Number(match.groups.credits.replace(/,/g, "")),
        saleType: "vendor",
      };
    }
  }
  for (const pattern of BAZAAR_PATTERNS) {
    const match = pattern.exec(haystack);
    if (match?.groups) {
      return {
        vendor: "",
        itemName: cleanName(match.groups.item),
        buyer: cleanName(match.groups.buyer),
        credits: Number(match.groups.credits.replace(/,/g, "")),
        saleType: "bazaar",
      };
    }
  }
  return null;
}

export interface ParsedPurchase {
  itemName: string;
  seller: string;
  credits: number;
  purchaseType: "vendor" | "bazaar";
}

const PURCHASE_PATTERNS: { pattern: RegExp; type: "vendor" | "bazaar" }[] = [
  // "You have won the auction of Mark V Reactor from Wrollo for 250000 credits"
  { pattern: new RegExp(String.raw`You (?:have )?won the auction of\s+(?<item>.+?)\s+from\s+(?<seller>.+?)\s+for\s+${CREDITS}`, "i"), type: "bazaar" },
  // "You have purchased Mark V Reactor from Wrollo for 250000 credits"
  { pattern: new RegExp(String.raw`You (?:have )?purchased\s+(?<item>.+?)\s+from\s+(?:the )?(?:[Vv]endor:?\s+)?(?<seller>.+?)\s+for\s+${CREDITS}`, "i"), type: "vendor" },
];

export function parsePurchase(mail: ParsedMail): ParsedPurchase | null {
  const haystack = `${mail.subject}\n${mail.body}`;
  for (const { pattern, type } of PURCHASE_PATTERNS) {
    const match = pattern.exec(haystack);
    if (match?.groups) {
      return {
        itemName: cleanName(match.groups.item),
        seller: cleanName(match.groups.seller),
        credits: Number(match.groups.credits.replace(/,/g, "")),
        purchaseType: type,
      };
    }
  }
  return null;
}

function cleanName(value: string): string {
  return value.trim().replace(/^\[|\]$/g, "").replace(/\s+/g, " ").replace(/\.+$/, "");
}
