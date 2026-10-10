const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PROMPT_PATH = path.join(__dirname, "..", "system_prompt.txt");
const MAX_LOAN_INR = 7500000;
const sessions = new Map();

function getSystemPrompt() {
  return fs.readFileSync(PROMPT_PATH, "utf8");
}

function createSession(input = {}) {
  const variables = {
    company_name: clean(input.company_name || process.env.COMPANY_NAME || "Home Credit"),
    customer_name: clean(input.customer_name || "Customer"),
    agent_name: clean(input.agent_name || process.env.AGENT_NAME || "Aarav"),
    agent_gender: clean(input.agent_gender || process.env.AGENT_GENDER || "male").toLowerCase(),
    current_date: input.current_date || new Date().toISOString().slice(0, 10),
    current_day: input.current_day || new Date().toLocaleDateString("en-US", { weekday: "long" }),
    current_time: input.current_time || new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    additional_context_from_rag: input.additional_context_from_rag || "",
    language_to_speak: normalizeLanguage(input.language_to_speak || process.env.DEFAULT_LANGUAGE || "English")
  };

  const session = {
    id: crypto.randomUUID(),
    variables,
    stage: "identity",
    answers: {
      property_type: null,
      ownership_status: null,
      original_documents_available: null,
      loan_amount_inr: null,
      occupation: null,
      income_mode: null,
      property_market_value_inr: null,
      tenure_years: null
    },
    asked: [],
    status: "active",
    endReason: null,
    lastReply: greeting(variables),
    history: []
  };
  session.history.push({ role: "assistant", content: session.lastReply });
  sessions.set(session.id, session);
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function processCustomerUtterance(id, utterance) {
  const session = getSession(id);
  if (!session) throw new Error("Session not found.");
  if (session.status !== "active") {
    return { reply: session.lastReply, status: session.status, session };
  }

  const text = clean(utterance);
  session.history.push({ role: "customer", content: text });

  const identityWasConfirmed = session.stage !== "identity";
  if (!identityWasConfirmed) {
    if (isBusy(text)) {
      session.stage = "callback";
      return finish(session, "callback_requested", callbackReply(session, text), "Customer is busy.");
    }
    if (isIdentityNo(text)) {
      return finish(session, "identity_unconfirmed",
        say(session, "I’m sorry to disturb you. I can’t share the details unless I’m speaking with the intended customer. Thank you for your time."),
        "Customer identity not confirmed.");
    }
    if (!isIdentityYes(text, session.variables.customer_name)) {
      return continueWith(session, say(session, `May I confirm whether I’m speaking with ${session.variables.customer_name}?`));
    }
    session.stage = "offer";
    const reply = say(session, `Thank you for confirming. I’m ${session.variables.agent_name}, calling from ${session.variables.company_name}. We’re contacting valued customers about a Loan Against Property offer of up to ₹75 lakh. This is a preliminary eligibility check, not a loan approval. Would you be comfortable answering a few quick questions?`);
    return continueWith(session, reply);
  }

  if (isTransferIntent(text)) {
    return finish(session, "transfer_handoff",
      say(session, "Understood. Since you mentioned an existing property loan or reducing your current EMI, a loan-transfer specialist will contact you shortly. Thank you for your time."),
      "Existing loan or EMI reduction intent.");
  }
  if (isBusy(text)) {
    return finish(session, "callback_requested", callbackReply(session, text), "Customer requested callback.");
  }
  if (isDecline(text)) {
    return finish(session, "declined", say(session, "Of course. Thank you for your time. Have a good day."), "Customer declined.");
  }

  if (session.stage === "offer") {
    if (isNegative(text)) {
      return finish(session, "declined", say(session, "No problem. Thank you for your time. Have a good day."), "Customer declined the offer.");
    }
    session.stage = "qualification";
  }

  if (session.pendingAmountCap) {
    if (isYes(text)) {
      session.answers.loan_amount_inr = MAX_LOAN_INR;
      session.pendingAmountCap = false;
    } else if (isNegative(text) || /\b(no|not|decline|don't|do not|cannot|can't|won't)\b/i.test(text)) {
      return finish(session, "amount_limit_declined", say(session, "I understand. This offer is capped at ₹75 lakh, so I won’t take this request forward. Thank you for your time."), "Customer declined maximum amount.");
    } else {
      return continueWith(session, say(session, "Would you like to proceed with the maximum available amount of ₹75 lakh, yes or no?"));
    }
  }

  const extraction = extractAnswers(text, session.answers);
  applyAnswers(session, extraction);

  const disqualification = findDisqualification(session.answers);
  if (disqualification) {
    return finish(session, "disqualified", disqualificationReply(session, disqualification), disqualification);
  }

  if (extraction.amountAboveLimit && session.answers.loan_amount_inr === null) {
    session.pendingAmountCap = true;
    return continueWith(session, say(session, "The maximum amount under this offer is ₹75 lakh. Would you like to continue with ₹75 lakh instead?"));
  }

  const next = nextMissingField(session.answers);
  if (next) {
    session.stage = "qualification";
    session.asked.push(next);
    return continueWith(session, questionFor(session, next));
  }

  if (allEligible(session.answers)) {
    return finish(session, "qualified_handoff",
      say(session, "Thank you. I’ve captured the preliminary details, and they meet the initial criteria we discussed. A senior loan expert will contact you shortly to explain the next steps and the exact interest rate. This is a preliminary check, not final loan approval."),
      "All required eligibility fields completed.");
  }

  return continueWith(session, say(session, "Could you please clarify that detail so I can record it accurately?"));
}

function applyAnswers(session, extracted) {
  const a = session.answers;
  for (const key of Object.keys(a)) {
    if (extracted[key] !== undefined && extracted[key] !== null) {
      a[key] = extracted[key];
    }
  }
}

function extractAnswers(text, currentAnswers) {
  const result = {};
  const lower = text.toLowerCase();

  if (/\b(agricultural|agriculture|farm land|farmland|खेती की जमीन|कृषि भूमि)\b/i.test(text)) {
    result.property_type = "agricultural";
  } else if (/\b(residential|house|flat|apartment|home|रिहायशी|घर|फ्लैट)\b/i.test(text)) {
    result.property_type = "residential";
  } else if (/\b(commercial|shop|office|दुकान|ऑफिस|व्यावसायिक)\b/i.test(text)) {
    result.property_type = "commercial";
  } else if (/\b(industrial|factory|कारखाना|औद्योगिक)\b/i.test(text)) {
    result.property_type = "industrial";
  }

  if (/\b(joint|co-owner|coowned|jointly|family owns|partner(?:s)? own|संयुक्त)\b/i.test(text)) result.ownership_status = "joint";
  else if (/\b(sole owner|solely owned|only owner|my name only|i own it alone|single owner|मेरे नाम पर ही|अकेला मालिक)\b/i.test(text)) result.ownership_status = "sole";

  if (/\b(originals?|original documents?|original papers?|असली दस्तावेज़|मूल दस्तावेज़)\b/i.test(text)) {
    if (/\b(no|not available|don't have|do not have|unavailable|missing|नहीं हैं|नहीं उपलब्ध)\b/i.test(text)) result.original_documents_available = false;
    else if (/\b(yes|have|available|ready|with me|can provide|हैं|उपलब्ध)\b/i.test(text)) result.original_documents_available = true;
  } else if (/\b(photocopies only|copies only|only copies)\b/i.test(text)) {
    result.original_documents_available = false;
  }

  const amount = parseMoney(text);
  const marketContext = /(?:market value|property value|worth|valued at|property is worth|कीमत|बाजार मूल्य|प्रॉपर्टी की वैल्यू)/i.test(text);
  const explicitLoanContext = /(?:loan|borrow|amount|लोन|चाहिए)/i.test(text);
  if (amount !== null) {
    if (amount > MAX_LOAN_INR && /(?:loan|borrow|need|want|amount|लोन|चाहिए)/i.test(text) && !marketContext) {
      result.amountAboveLimit = true;
    } else if ((explicitLoanContext || (/\b(need|want)\b/i.test(text) && !marketContext)) || (currentAnswers.loan_amount_inr === null && !marketContext)) {
      result.loan_amount_inr = amount;
    }
  }

  if (/\b(salaried|salary|employee|job|नौकरी|वेतनभोगी)\b/i.test(text)) result.occupation = "salaried";
  else if (/\b(self[- ]?employed|business owner|own business|runs a business|businessman|व्यवसाय|स्वरोजगार)\b/i.test(text)) result.occupation = "self-employed";

  if (/\b(cash|in cash|paid cash|नकद|कैश)\b/i.test(text)) result.income_mode = "cash";
  else if (/\b(bank|bank account|through bank|salary account|बैंक|खाते में)\b/i.test(text)) result.income_mode = "bank";

  const marketValue = parseMoney(text);
  if (marketValue !== null && /\b(market value|property value|worth|valued at|property is worth|कीमत|बाजार मूल्य|प्रॉपर्टी की वैल्यू)\b/i.test(text)) {
    result.property_market_value_inr = marketValue;
  }

  const tenure = parseTenure(text);
  if (tenure !== null) result.tenure_years = tenure;

  return result;
}

function parseMoney(text) {
  const s = text.toLowerCase().replace(/,/g, "");
  const crore = s.match(/(\d+(?:\.\d+)?)\s*(?:crore|crores|cr\b|करोड़)/i);
  if (crore) return Math.round(Number(crore[1]) * 10000000);
  const lakh = s.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs|लाख)/i);
  if (lakh) return Math.round(Number(lakh[1]) * 100000);
  const rupees = s.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)|(\d{6,})\s*(?:rupees|rs|inr|रुपये)?/i);
  if (rupees) return Math.round(Number(rupees[1] || rupees[2]));
  const bare = s.match(/\b(\d{6,8})\b/);
  return bare ? Number(bare[1]) : null;
}

function parseTenure(text) {
  const years = text.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?|साल|वर्ष)/i);
  if (years && /\b(tenure|repay|repayment|years?|yrs?|साल|वर्ष|चुकाने)\b/i.test(text)) return Number(years[1]);
  const months = text.match(/(\d+)\s*months?/i);
  if (months && /\b(tenure|repay|repayment|months?)\b/i.test(text)) return Number(months[1]) / 12;
  const justYears = text.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (justYears && Number(justYears[1]) <= 30) return Number(justYears[1]);
  return null;
}

function findDisqualification(a) {
  if (a.property_type === "agricultural") return "Agricultural property is not eligible.";
  if (a.original_documents_available === false) return "Original property documents are required.";
  if (a.loan_amount_inr !== null && a.loan_amount_inr > MAX_LOAN_INR) return "Requested loan amount exceeds the maximum offer.";
  if (a.income_mode === "cash") return "Income received in cash does not meet this offer's criteria.";
  if (a.tenure_years !== null && (a.tenure_years < 3 || a.tenure_years > 15)) return "Requested tenure is outside the eligible 3-to-15-year range.";
  return null;
}

function nextMissingField(a) {
  const ordered = [
    ["property_type", "property_type"],
    ["ownership_status", "ownership_status"],
    ["original_documents_available", "original_documents_available"],
    ["loan_amount_inr", "loan_amount_inr"],
    ["occupation", "occupation"],
    ["income_mode", "income_mode"],
    ["property_market_value_inr", "property_market_value_inr"],
    ["tenure_years", "tenure_years"]
  ];
  for (const [key] of ordered) {
    if (a[key] === null || a[key] === undefined) return key;
  }
  return null;
}

function allEligible(a) {
  return ["residential", "commercial", "industrial"].includes(a.property_type)
    && ["sole", "joint"].includes(a.ownership_status)
    && a.original_documents_available === true
    && Number.isFinite(a.loan_amount_inr)
    && a.loan_amount_inr >= 0
    && a.loan_amount_inr <= MAX_LOAN_INR
    && ["salaried", "self-employed"].includes(a.occupation)
    && a.income_mode === "bank"
    && Number.isFinite(a.property_market_value_inr)
    && a.property_market_value_inr >= 0
    && Number.isFinite(a.tenure_years)
    && a.tenure_years >= 3
    && a.tenure_years <= 15;
}

function questionFor(session, field) {
  const lang = session.variables.language_to_speak;
  const hi = lang === "Hindi";
  const questions = {
    property_type: hi
      ? "आप किस प्रकार की संपत्ति के आधार पर लोन लेना चाहते हैं—रिहायशी, कमर्शियल या इंडस्ट्रियल?"
      : "What type of property would you like to use—residential, commercial, or industrial?",
    ownership_status: hi
      ? "क्या संपत्ति केवल आपके नाम पर है या परिवार के सदस्य/पार्टनर के साथ संयुक्त स्वामित्व में है?"
      : "Is the property solely owned by you, or is it jointly owned with family members or partners?",
    original_documents_available: hi
      ? "क्या आपके पास सत्यापन के लिए संपत्ति के मूल दस्तावेज़ उपलब्ध हैं?"
      : "Are the original property documents available for verification?",
    loan_amount_inr: hi
      ? "आप कितनी राशि का लोन लेना चाहते हैं? इस ऑफर की अधिकतम सीमा ₹75 लाख है।"
      : "How much would you like to borrow? The maximum under this offer is ₹75 lakh.",
    occupation: hi
      ? "आप नौकरी करते हैं या अपना व्यवसाय चलाते हैं? और आपकी आय बैंक खाते में आती है या नकद मिलती है?"
      : "Are you salaried or self-employed? Also, is your income received through a bank account or in cash?",
    income_mode: hi
      ? "आपकी आय बैंक खाते में आती है या नकद मिलती है?"
      : "Is your income received through a bank account or in cash?",
    property_market_value_inr: hi
      ? "आपकी संपत्ति का अनुमानित वर्तमान बाज़ार मूल्य कितना है?"
      : "What is the estimated current market value of your property?",
    tenure_years: hi
      ? "आप कितने वर्षों में लोन चुकाना चाहेंगे? अवधि 3 से 15 वर्ष के बीच होनी चाहिए।"
      : "Over how many years would you like to repay the loan? The tenure must be between 3 and 15 years."
  };
  return say(session, questions[field]);
}

function greeting(v) {
  return v.language_to_speak === "Hindi"
    ? `नमस्ते, क्या मैं ${v.customer_name} जी से बात कर रहा/रही हूँ?`
    : `Hello, may I speak with ${v.customer_name}?`;
}

function callbackReply(session, text) {
  const match = text.match(/\b(?:at|around|after|by|on)\s+([^,.!?]+)/i);
  const time = match ? ` Would ${match[1].trim()} be a suitable time?` : " What would be a convenient time for us to call you back?";
  return say(session, `Of course, I understand you’re busy.${time} Thank you for your time.`);
}

function disqualificationReply(session, reason) {
  return say(session, `Thank you for explaining that. Based on the information you’ve shared, this specific Loan Against Property offer’s current criteria aren’t met, so I can’t take this application forward under this offer at this time. Thank you for your time.`);
}

function continueWith(session, reply) {
  session.lastReply = reply;
  session.history.push({ role: "assistant", content: reply });
  return { reply, status: session.status, session };
}

function finish(session, status, reply, reason) {
  session.status = status;
  session.endReason = reason;
  session.lastReply = reply;
  session.history.push({ role: "assistant", content: reply });
  return { reply, status, session };
}

function say(session, english) {
  if (session.variables.language_to_speak !== "Hindi") return english;
  const replacements = [
    [/^Thank you for confirming\./, "पुष्टि करने के लिए धन्यवाद।"],
    [/^No problem\./, "कोई बात नहीं।"],
    [/^Of course, I understand you’re busy\./, "जी, मैं समझ सकता/सकती हूँ कि आप व्यस्त हैं।"],
    [/^Thank you for explaining that\./, "यह जानकारी देने के लिए धन्यवाद।"],
    [/^Understood\./, "समझ गया/गई।"],
    [/^Hello, may I speak with (.+)\?$/, "नमस्ते, क्या मैं $1 से बात कर सकता/सकती हूँ?"]
  ];
  let out = english;
  for (const [pattern, replacement] of replacements) out = out.replace(pattern, replacement);
  return out;
}

function normalizeLanguage(value) {
  return /^hi(nd(i)?)?$/i.test(String(value).trim()) ? "Hindi" : "English";
}
function clean(value) { return String(value == null ? "" : value).trim(); }
function isBusy(text) { return /\b(busy|driving|in a meeting|call me back|callback|call back|later|not a good time|व्यस्त|बाद में कॉल)\b/i.test(text); }
function isTransferIntent(text) { return /\b(existing loan|already have (?:a )?(?:loan|mortgage)|loan on (?:the )?property|balance transfer|transfer (?:my|the|existing) loan|reduce (?:my|the|current) emi|lower (?:my|the|current) emi|current emi|मौजूदा लोन|ईएमआई कम|लोन ट्रांसफर)\b/i.test(text); }
function isDecline(text) { return /\b(not interested|don't want|do not want|stop calling|remove me|no thanks|not required|नहीं चाहिए|रुचि नहीं)\b/i.test(text); }
function isIdentityNo(text) { return /\b(wrong number|not (?:him|her|the customer|that person)|you have the wrong|isn't here|not available)\b/i.test(text); }
function isIdentityYes(text, name) {
  if (/\b(yes|speaking|this is me|that's me|correct person|बोल रहा|बोल रही|जी हाँ|हां)\b/i.test(text)) return true;
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  return parts.some(part => part.length > 2 && text.toLowerCase().includes(part));
}
function isYes(text) { return /\b(yes|yeah|yep|sure|okay|ok|proceed|go ahead|that works|हाँ|हां|ठीक है)\b/i.test(text); }
function isNegative(text) { return /\b(no|nope|not|don't|do not|cannot|can't|won't|नहीं)\b/i.test(text); }

module.exports = {
  createSession,
  processCustomerUtterance,
  getSession,
  getSystemPrompt,
  extractAnswers,
  parseMoney,
  parseTenure,
  nextMissingField,
  allEligible,
  findDisqualification,
  _sessions: sessions,
  MAX_LOAN_INR
};
