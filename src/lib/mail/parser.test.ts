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
