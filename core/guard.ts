// Connective-language guard. Model-written text segments may connect facts but must not state any
// number, amount, currency, date or month. Anything the guard cannot see (for example a number
// phrased as an idiom) is the semantic layer's job; the gap is listed in the README.

export type GuardCategory = "digit" | "currency" | "number_word" | "month";
export interface GuardViolation { category: GuardCategory; match: string }

// Zero-width joiners and non-joiners are legitimate in Indic scripts; remove them before matching words.
const INVISIBLE = /[​-‍⁠﻿]/gu;
const B = (body: string) => `(?<![\\p{L}\\p{M}\\p{N}])(?:${body})(?![\\p{L}\\p{M}\\p{N}])`;

const EN_NUMBERS = [
  "zero", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty",
  "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands",
  "lakh", "lakhs", "lac", "lacs", "crore", "crores", "million", "billion", "dozen",
  // Ordinals (first and second are left out: too common in ordinary prose; see README gap).
  "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth",
  "fifteenth", "twentieth", "thirtieth", "twice",
];
// Common transliterated Hindi / Hinglish number words ("do" is omitted: it is an English word).
const HI_ROMAN = [
  "teen", "char", "chaar", "paanch", "panch", "chhe", "chhah", "saat", "aath", "nau", "das", "gyarah",
  "barah", "terah", "chaudah", "pandrah", "solah", "satrah", "atharah", "unnis", "bees", "tees", "chalis",
  "pachas", "saath", "sattar", "assi", "nabbe", "sau", "hazaar", "hazar", "lakh", "karod", "crore", "dedh", "dhai",
];
const TE_ROMAN = [
  "okati", "rendu", "moodu", "mudu", "nalugu", "aidu", "aaru", "edu", "enimidi", "tommidi", "padi",
  "vanda", "veyyi", "laksha", "koti",
];
const DEVANAGARI = [
  "दो", "तीन", "चार", "पाँच", "पांच", "छह", "छः", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह",
  "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस", "बीस", "तीस", "चालीस", "पचास", "साठ", "सत्तर", "अस्सी", "नब्बे",
  "सौ", "हज़ार", "हजार", "लाख", "करोड़", "करोड", "डेढ़", "ढाई",
];
const TELUGU = [
  "ఒకటి", "రెండు", "మూడు", "నాలుగు", "ఐదు", "ఆరు", "ఏడు", "ఎనిమిది", "తొమ్మిది", "పది", "పదకొండు", "పన్నెండు",
  "ఇరవై", "ముప్పై", "నలభై", "యాభై", "అరవై", "డెబ్బై", "ఎనభై", "తొంభై", "వంద", "వెయ్యి", "లక్ష", "కోటి",
];
const CURRENCY_WORDS = [
  "rupee", "rupees", "rupaye", "rupaya", "rupya", "rupay", "rs", "inr", "paise", "paisa", "रुपये", "रुपया", "रुपए", "रूपये",
  "रु", "पैसे", "पैसा", "రూపాయలు", "రూపాయి", "రూపాయల", "రూ", "పైసలు",
];
// Ambiguous short words ("may", "march", "mar") are matched only in their capitalised form.
const MONTHS_EN_CI = [
  "january", "february", "april", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
];
const MONTHS_EN_CS = ["May", "March", "Mar"];
const MONTHS_INDIC = [
  "जनवरी", "फरवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "सितम्बर", "अक्टूबर",
  "नवंबर", "नवम्बर", "दिसंबर", "दिसम्बर", "జనవరి", "ఫిబ్రవరి", "మార్చి", "ఏప్రిల్", "మే", "జూన్", "జూలై",
  "ఆగస్టు", "సెప్టెంబర్", "అక్టోబర్", "నవంబర్", "డిసెంబర్",
];

// "one", "once", "ek", "एक", "ఒక" are also ordinary determiners ("once the payment clears", "no one", "ek manager"). They are
// blocked only when they quantify a unit of time, money or count ("one week", "ek din", "once a month"); the larger
// number words stay blocked everywhere.
const DETERMINERS = ["one", "once", "ek", "एक", "ఒక"];
const QUANTIFIED = [
  "day", "days", "week", "weeks", "month", "months", "year", "years", "hour", "hours", "minute", "minutes", "time", "times", "a day", "a week", "a month", "a year",
  "din", "hafte", "hafta", "mahina", "mahine", "saal", "ghanta", "ghante", "baar", "दिन", "हफ्ते", "हफ़्ते", "सप्ताह", "महीना", "महीने", "साल", "घंटा", "घंटे", "बार",
  "రోజు", "రోజులు", "వారం", "నెల", "సంవత్సరం", "గంట", "సారి",
  "rupee", "rupees", "rupaye", "paisa", "paise", "रुपये", "रुपया", "రూపాయి", "payment", "installment", "instalment",
];
const alt = (words: string[]) => words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

const RE = {
  digit: /[\p{Nd}\p{No}\p{Nl}]/u, // any decimal digit in any script, plus fractions, superscripts, Roman numerals
  currencySymbol: /\p{Sc}/u,
  currencyWord: new RegExp(B(alt(CURRENCY_WORDS)), "iu"),
  numberWord: new RegExp(B(alt([...EN_NUMBERS, ...HI_ROMAN, ...TE_ROMAN, ...DEVANAGARI, ...TELUGU])), "iu"),
  monthCi: new RegExp(B(alt([...MONTHS_EN_CI, ...MONTHS_INDIC])), "iu"),
  monthCs: new RegExp(B(alt(MONTHS_EN_CS)), "u"),
  quantified: new RegExp(`${B(alt(DETERMINERS))}\\s+${B(alt(QUANTIFIED))}`, "iu"),
};

export function guardText(input: string): GuardViolation[] {
  const text = input.normalize("NFKC").replace(INVISIBLE, "");
  const out: GuardViolation[] = [];
  const hit = (category: GuardCategory, re: RegExp) => {
    const m = re.exec(text);
    if (m) out.push({ category, match: m[0] });
  };
  hit("digit", RE.digit);
  hit("currency", RE.currencySymbol);
  hit("currency", RE.currencyWord);
  hit("number_word", RE.numberWord);
  hit("number_word", RE.quantified);
  hit("month", RE.monthCi);
  hit("month", RE.monthCs);
  return out;
}

export const guardPasses = (text: string): boolean => guardText(text).length === 0;
