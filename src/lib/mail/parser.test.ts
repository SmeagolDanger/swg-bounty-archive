import { describe, expect, it } from "vitest";
import { mailFingerprint, parseMail, parseSale } from "./parser";

const vendorMail = `184467
FROM: SWG.Omega.auctioner
SUBJECT: Vendor Sale Complete
TIMESTAMP: 1755468000

Vendor: Hangar Nine has sold [Mark V Reactor, Overhauled] to Wrollo for 250,000 credits.`;

const bazaarMail = `184468
FROM: SWG.Omega.auctioner
SUBJECT: Sale Complete
TIMESTAMP: 1755469000

Your auction of Mark III Capacitor has been sold to Skippi for 42000 credits`;

const chatterMail = `184469
FROM: Wrollo
SUBJECT: re: that reactor
TIMESTAMP: 1755470000

thanks for the deal, flies great`;

describe("SWG mailsave parser", () => {
  it("parses headers, timestamp, and body", () => {
    const mail = parseMail(vendorMail);
    expect(mail.mailId).toBe("184467");
    expect(mail.sender).toBe("SWG.Omega.auctioner");
    expect(mail.subject).toBe("Vendor Sale Complete");
    expect(mail.sentAt?.toISOString()).toBe(new Date(1755468000 * 1000).toISOString());
    expect(mail.body).toContain("Hangar Nine");
  });

  it("fingerprints are newline-normalized and stable", () => {
    expect(mailFingerprint(vendorMail)).toBe(mailFingerprint(vendorMail.replace(/\n/g, "\r\n")));
  });

  it("extracts a vendor sale with separators and brackets cleaned", () => {
    const sale = parseSale(parseMail(vendorMail));
    expect(sale).toEqual({
      vendor: "Hangar Nine",
      itemName: "Mark V Reactor, Overhauled",
      buyer: "Wrollo",
      credits: 250_000,
      saleType: "vendor",
    });
  });

  it("extracts a bazaar sale", () => {
    const sale = parseSale(parseMail(bazaarMail));
    expect(sale).toEqual({
      vendor: "",
      itemName: "Mark III Capacitor",
      buyer: "Skippi",
      credits: 42_000,
      saleType: "bazaar",
    });
  });

  it("ignores ordinary mail", () => {
    expect(parseSale(parseMail(chatterMail))).toBeNull();
  });
});

const positionalMail = `184470
SWG.Omega.auctioner
Vendor Sale Complete
TIMESTAMP: 1755471000

Vendor: Hangar Nine has sold [Mark I Booster] to Skippi for 12,000 credits.`;

describe("positional mailsave format (live SWG output)", () => {
  it("reads sender and subject from unprefixed lines", () => {
    const mail = parseMail(positionalMail);
    expect(mail.mailId).toBe("184470");
    expect(mail.sender).toBe("SWG.Omega.auctioner");
    expect(mail.subject).toBe("Vendor Sale Complete");
    expect(mail.sentAt?.toISOString()).toBe(new Date(1755471000 * 1000).toISOString());
    expect(parseSale(mail)?.credits).toBe(12_000);
  });
});

import { parsePurchase } from "./parser";

const wonAuctionMail = `184471
SWG.Omega.auctioner
Auction Won
TIMESTAMP: 1755472000

You have won the auction of Mark IV Engine from Torye Klyn for 98,500 credits`;

const purchasedMail = `184472
SWG.Omega.auctioner
Item Purchased
TIMESTAMP: 1755473000

You have purchased [Chaff Launcher] from Vendor: Hangar Nine for 15000 credits.`;

describe("purchase parsing", () => {
  it("extracts a won auction", () => {
    expect(parsePurchase(parseMail(wonAuctionMail))).toEqual({
      itemName: "Mark IV Engine", seller: "Torye Klyn", credits: 98_500, purchaseType: "bazaar",
    });
  });
  it("extracts a vendor purchase", () => {
    expect(parsePurchase(parseMail(purchasedMail))).toEqual({
      itemName: "Chaff Launcher", seller: "Hangar Nine", credits: 15_000, purchaseType: "vendor",
    });
  });
  it("does not misread a sale as a purchase", () => {
    expect(parsePurchase(parseMail(vendorMail))).toBeNull();
  });
});

describe("timestamp variants", () => {
  it("parses a bare positional unix stamp line", () => {
    const mail = parseMail("184001\nSWG.Omega.auctioner\nVendor Sale Complete\n1733076000\n\nVendor: Hangar Nine has sold [Mark V Reactor] to Wrollo for 250,000 credits.");
    expect(mail.subject).toBe("Vendor Sale Complete");
    expect(mail.sentAt?.toISOString()).toBe("2024-12-01T18:00:00.000Z");
    expect(mail.body.startsWith("Vendor:")).toBe(true);
    expect(parseSale(mail)?.itemName).toBe("Mark V Reactor");
  });

  it("parses millisecond stamps and lowercase prefixes", () => {
    const ms = parseMail("184002\nSender\nSubject\n1733076000000\n\nbody");
    expect(ms.sentAt?.toISOString()).toBe("2024-12-01T18:00:00.000Z");
    const lower = parseMail("184003\nFrom: Sender\nSubject: Hello\ntimestamp: 1733076000\n\nbody");
    expect(lower.sender).toBe("Sender");
    expect(lower.subject).toBe("Hello");
    expect(lower.sentAt?.toISOString()).toBe("2024-12-01T18:00:00.000Z");
  });
});

describe("live Omega mailsave format", () => {
  // Exact shape confirmed from production raws: underscore id line,
  // positional sender/subject, prefixed TIMESTAMP, no blank before body.
  const raw = "61241977_1770481480\r\nSWG.Omega.auctioner\r\nVendor Sale Complete\r\nTIMESTAMP: 1770481480\r\nVendor: Hangar Nine has sold [Mark V Reactor] to Wrollo for 250,000 credits.";

  it("aligns headers despite the underscore id line", () => {
    const mail = parseMail(raw);
    expect(mail.mailId).toBe("61241977_1770481480");
    expect(mail.sender).toBe("SWG.Omega.auctioner");
    expect(mail.subject).toBe("Vendor Sale Complete");
    expect(mail.sentAt?.getTime()).toBe(1770481480 * 1000);
    expect(mail.body.startsWith("Vendor:")).toBe(true);
    expect(parseSale(mail)?.buyer).toBe("Wrollo");
  });

  it("falls back to the id suffix when no TIMESTAMP line exists", () => {
    const mail = parseMail("61241977_1770481480\nSWG.Omega.auctioner\nSubject\nbody text here");
    expect(mail.sentAt?.getTime()).toBe(1770481480 * 1000);
  });
});
