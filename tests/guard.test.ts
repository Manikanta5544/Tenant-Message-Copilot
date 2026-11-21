import { describe, expect, it } from "vitest";
import { guardPasses, guardText } from "../core/guard";

const bad: [string, string, string][] = [
  ["latin digit", "Your balance is 12000", "digit"],
  ["devanagari digit", "आपका बकाया १२ है", "digit"],
  ["telugu digit", "మీ బకాయి ౧౨ ఉంది", "digit"],
  ["arabic-indic digit", "balance ١٢", "digit"],
  ["fullwidth digit", "balance １２", "digit"],
  ["fraction", "about ½ of it", "digit"],
  ["rupee symbol", "You owe ₹ now", "currency"],
  ["dollar symbol", "That is $ worth", "currency"],
  ["rupees word", "You paid in rupees", "currency"],
  ["rs abbreviation", "Rs balance", "currency"],
  ["hindi rupees", "आपने रुपये भेजे", "currency"],
  ["telugu rupees", "మీరు రూపాయలు పంపారు", "currency"],
  ["english number word", "You paid eight thousand", "number_word"],
  ["lakh", "about a lakh", "number_word"],
  ["ordinal", "due on the fifth", "number_word"],
  ["hinglish number", "aapne ek baar bheja", "number_word"],
  ["hinglish hazaar", "aath hazaar", "number_word"],
  ["devanagari number word", "आपने आठ हज़ार भेजे", "number_word"],
  ["telugu number word", "మీరు ఎనిమిది వేలు", "number_word"],
  ["english month", "paid in November", "month"],
  ["capitalised May", "paid in May", "month"],
  ["hindi month", "नवंबर में", "month"],
  ["telugu month", "నవంబర్ లో", "month"],
];

describe("connective-language guard", () => {
  it.each(bad)("blocks %s", (_n, text, category) => {
    expect(guardText(text).map((v) => v.category)).toContain(category);
  });
  it("blocks digits split by zero-width characters", () => {
    expect(guardPasses("balance 1​2")).toBe(false);
  });
  const good = [
    "Thanks for reaching out. Your balance is shown below, after the payment we have on record.",
    "You may keep the receipt for your records.",
    "Please wait while we confirm with the bank; a manager will review this.",
    "Aapka payment abhi pending dikh raha hai, hum bank se confirm karenge.",
    "आपका भुगतान अभी लंबित है, हम बैंक से पुष्टि करेंगे।",
    "మీ చెల్లింపు ఇంకా పెండింగ్‌లో ఉంది, మేనేజర్ పరిశీలిస్తారు.",
    "Our maintenance team will acknowledge your request soon.",
  ];
  it.each(good)("allows ordinary prose: %s", (text) => {
    expect(guardText(text)).toEqual([]);
  });
  it("documents known gaps rather than hiding them", () => {
    // Not blocked: "first" and "second", and idioms such as "a couple". The semantic layer covers these.
    expect(guardPasses("First, please check the receipt.")).toBe(true);
  });
});

describe("determiners are allowed, quantities are not", () => {
  it.each([
    "Once the payment is confirmed, a manager will follow up.",
    "No one has been able to confirm this yet.",
    "Ek property manager aapse sampark karenge.",
    "एक प्रॉपर्टी मैनेजर आपसे संपर्क करेंगे।",
    "ఒక మేనేజర్ మిమ్మల్ని సంప్రదిస్తారు.",
  ])("allows %s", (t) => expect(guardPasses(t)).toBe(true));
  it.each([
    "We will fix this within one week.",
    "Ek din mein ho jayega.",
    "You can pay once a month.",
    "एक दिन में हो जाएगा।",
    "one hundred",
    "ek lakh",
  ])("still blocks %s", (t) => expect(guardPasses(t)).toBe(false));
});
