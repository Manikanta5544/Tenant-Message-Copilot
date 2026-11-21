// Deterministic reply templates. No model, no numbers, no claims: used for holding replies,
// refusals, provider failure and budget exhaustion. Every template is a draft for a manager.
import type { Draft } from "./facts";
import type { Language } from "./types";

export type TemplateKind = "holding" | "refusal" | "escalation" | "unavailable";

const T: Record<TemplateKind, Record<Language, string>> = {
  holding: {
    English: "Thank you for your message. We are checking the details and a property manager will get back to you shortly.",
    Hinglish: "Aapke message ke liye dhanyavaad. Hum details check kar rahe hain aur property manager jaldi aapse sampark karenge.",
    Hindi: "आपके संदेश के लिए धन्यवाद। हम जानकारी जाँच रहे हैं और प्रॉपर्टी मैनेजर जल्द ही आपसे संपर्क करेंगे।",
    Telugu: "మీ సందేశానికి ధన్యవాదాలు. మేము వివరాలను పరిశీలిస్తున్నాము, ప్రాపర్టీ మేనేజర్ త్వరలో మిమ్మల్ని సంప్రదిస్తారు.",
  },
  refusal: {
    English: "Thank you for your message. We can only share information about your own tenancy in this chat, so we are unable to help with this request. A property manager has been informed.",
    Hinglish: "Aapke message ke liye dhanyavaad. Is chat mein hum sirf aapke apne tenancy ki jaankari de sakte hain, isliye is request mein madad nahi kar sakte. Property manager ko soochit kar diya gaya hai.",
    Hindi: "आपके संदेश के लिए धन्यवाद। इस चैट में हम केवल आपके अपने किरायेदारी की जानकारी साझा कर सकते हैं, इसलिए इस अनुरोध में सहायता नहीं कर सकते। प्रॉपर्टी मैनेजर को सूचित कर दिया गया है।",
    Telugu: "మీ సందేశానికి ధన్యవాదాలు. ఈ చాట్‌లో మేము మీ స్వంత అద్దె వివరాలను మాత్రమే పంచుకోగలము, కాబట్టి ఈ అభ్యర్థనకు సహాయం చేయలేము. ప్రాపర్టీ మేనేజర్‌కు తెలియజేయబడింది.",
  },
  escalation: {
    English: "Thank you for your message. This matter needs a decision from a property manager, so we have passed it on and someone will contact you. We are not able to give an answer in this chat.",
    Hinglish: "Aapke message ke liye dhanyavaad. Is mamle mein property manager ka nirnay zaroori hai, isliye humne ise aage bhej diya hai aur koi aapse sampark karega. Is chat mein hum jawab nahi de sakte.",
    Hindi: "आपके संदेश के लिए धन्यवाद। इस मामले में प्रॉपर्टी मैनेजर का निर्णय आवश्यक है, इसलिए हमने इसे आगे भेज दिया है और कोई आपसे संपर्क करेगा। इस चैट में हम उत्तर नहीं दे सकते।",
    Telugu: "మీ సందేశానికి ధన్యవాదాలు. ఈ విషయంలో ప్రాపర్టీ మేనేజర్ నిర్ణయం అవసరం, కాబట్టి దీన్ని ముందుకు పంపాము, ఎవరో మిమ్మల్ని సంప్రదిస్తారు. ఈ చాట్‌లో మేము సమాధానం ఇవ్వలేము.",
  },
  unavailable: {
    English: "Thank you for your message. Our assistant is not available right now, so a property manager will read your message and reply personally.",
    Hinglish: "Aapke message ke liye dhanyavaad. Hamara assistant abhi available nahi hai, isliye property manager aapka message padhkar khud jawab denge.",
    Hindi: "आपके संदेश के लिए धन्यवाद। हमारा सहायक अभी उपलब्ध नहीं है, इसलिए प्रॉपर्टी मैनेजर आपका संदेश पढ़कर स्वयं उत्तर देंगे।",
    Telugu: "మీ సందేశానికి ధన్యవాదాలు. మా సహాయకుడు ప్రస్తుతం అందుబాటులో లేడు, కాబట్టి ప్రాపర్టీ మేనేజర్ మీ సందేశాన్ని చదివి స్వయంగా సమాధానం ఇస్తారు.",
  },
};

/** A template as a draft: one text segment, no facts, no quotes. */
export function templateDraft(kind: TemplateKind, language: Language): Draft {
  return { language, segments: [{ type: "text", text: T[kind][language] }] };
}
