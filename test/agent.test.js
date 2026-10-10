const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSession,
  processCustomerUtterance,
  getSession,
  extractAnswers,
  parseMoney,
  parseTenure,
  allEligible,
  findDisqualification,
  MAX_LOAN_INR
} = require("../src/agent");

function say(session, utterance) {
  return processCustomerUtterance(session.id, utterance);
}
function verify(session) {
  say(session, "Yes, this is me.");
}
function answerAllEligible(session) {
  verify(session);
  say(session, "Yes, I can talk.");
  say(session, "It is a residential flat.");
  say(session, "I am the sole owner.");
  say(session, "Yes, I have the original documents.");
  say(session, "I need a loan of 40 lakh.");
  say(session, "I am salaried and my income comes through my bank account.");
  say(session, "The market value of the property is around 90 lakh.");
  return say(session, "I would like a tenure of 10 years.");
}

test("creates a session with the expected initial greeting and state", () => {
  const session = createSession({ customer_name: "Priya Sharma" });
  assert.match(session.lastReply, /Priya Sharma/);
  assert.equal(session.status, "active");
  assert.equal(session.answers.property_type, null);
  assert.equal(getSession(session.id), session);
});

test("does not reveal the offer before identity confirmation", () => {
  const session = createSession({ customer_name: "Priya" });
  const result = say(session, "Who is calling?");
  assert.equal(result.status, "active");
  assert.match(result.reply, /confirm/i);
  assert.doesNotMatch(result.reply, /75 lakh/i);
});

test("busy customer is asked for callback and session ends", () => {
  const session = createSession();
  const result = say(session, "I am in a meeting, please call me back at 4 pm.");
  assert.equal(result.status, "callback_requested");
  assert.match(result.reply, /convenient time|suitable time/i);
});

test("wrong identity ends without disclosing offer", () => {
  const session = createSession();
  const result = say(session, "Wrong number, she isn't here.");
  assert.equal(result.status, "identity_unconfirmed");
  assert.doesNotMatch(result.reply, /75 lakh/i);
});

test("existing property loan routes to transfer specialist immediately", () => {
  const session = createSession();
  verify(session);
  const result = say(session, "I already have a loan on this property and want to reduce my EMI.");
  assert.equal(result.status, "transfer_handoff");
  assert.match(result.reply, /loan-transfer specialist/i);
});

test("declined offer ends politely", () => {
  const session = createSession();
  verify(session);
  const result = say(session, "No, I am not interested.");
  assert.equal(result.status, "declined");
});

test("agricultural property immediately disqualifies", () => {
  const session = createSession();
  verify(session);
  say(session, "Yes, let's talk.");
  const result = say(session, "It is agricultural land.");
  assert.equal(result.status, "disqualified");
  assert.match(result.reply, /criteria/i);
});

test("unavailable original documents immediately disqualify", () => {
  const session = createSession();
  verify(session);
  say(session, "Okay.");
  say(session, "Residential house.");
  say(session, "Joint ownership with my brother.");
  const result = say(session, "I only have photocopies; originals are not available.");
  assert.equal(result.status, "disqualified");
});

test("cash income immediately disqualifies", () => {
  const session = createSession();
  verify(session);
  say(session, "Sure.");
  say(session, "Commercial shop.");
  say(session, "Sole owner.");
  say(session, "Original documents are available.");
  say(session, "I need 20 lakh.");
  const result = say(session, "I am self-employed and receive income in cash.");
  assert.equal(result.status, "disqualified");
});

test("tenure under 3 years or over 15 years disqualifies", () => {
  const a = createSession();
  verify(a);
  say(a, "Okay.");
  say(a, "Residential house.");
  say(a, "Sole owner.");
  say(a, "Original documents are available.");
  say(a, "I need 25 lakh.");
  say(a, "I am salaried and my income is received by bank.");
  say(a, "Market value is 70 lakh.");
  const result = say(a, "I want to repay in 2 years.");
  assert.equal(result.status, "disqualified");
});

test("amount over 75 lakh asks whether customer accepts the cap", () => {
  const session = createSession();
  verify(session);
  say(session, "Okay.");
  say(session, "Residential flat.");
  say(session, "Sole owner.");
  say(session, "Original documents are available.");
  const result = say(session, "I need a loan of 90 lakh.");
  assert.equal(result.status, "active");
  assert.match(result.reply, /maximum amount.*75 lakh/i);
  const capped = say(session, "Yes, proceed with 75 lakh.");
  assert.equal(capped.session.answers.loan_amount_inr, MAX_LOAN_INR);
});

test("customer can decline capped amount", () => {
  const session = createSession();
  verify(session);
  say(session, "Okay.");
  say(session, "Residential house.");
  say(session, "Sole owner.");
  say(session, "Original documents are available.");
  say(session, "I need 90 lakh.");
  const result = say(session, "No, I need the full 90 lakh.");
  assert.equal(result.status, "amount_limit_declined");
});

test("out-of-order details are stored and not asked again", () => {
  const session = createSession();
  verify(session);
  say(session, "Okay.");
  const result = say(session, "It's a residential flat, worth about 80 lakh, and I want 8 years to repay.");
  assert.equal(result.session.answers.property_type, "residential");
  assert.equal(result.session.answers.property_market_value_inr, 8000000);
  assert.equal(result.session.answers.tenure_years, 8);
  assert.match(result.reply, /solely owned|jointly owned/i);
});

test("eligible conversation only hands off after all required fields are complete", () => {
  const session = createSession();
  const result = answerAllEligible(session);
  assert.equal(result.status, "qualified_handoff");
  assert.match(result.reply, /senior loan expert/i);
  assert.equal(allEligible(result.session.answers), true);
});

test("final handoff is blocked when market value is missing", () => {
  const session = createSession();
  verify(session);
  say(session, "Okay.");
  say(session, "Residential house.");
  say(session, "Sole owner.");
  say(session, "Original documents are available.");
  say(session, "I need 25 lakh.");
  say(session, "I am salaried and my income comes through bank.");
  const result = say(session, "I want a tenure of 10 years.");
  assert.equal(result.status, "active");
  assert.match(result.reply, /market value/i);
});

test("parses money expressions", () => {
  assert.equal(parseMoney("75 lakh"), 7500000);
  assert.equal(parseMoney("0.75 crore"), 7500000);
  assert.equal(parseMoney("₹25,00,000"), 2500000);
});

test("parses tenure in years and months", () => {
  assert.equal(parseTenure("I want 10 years to repay"), 10);
  assert.equal(parseTenure("tenure is 36 months"), 3);
});

test("income and occupation can be extracted from a full sentence", () => {
  const result = extractAnswers("I run my own business and all my income is credited to my bank account.", {});
  assert.equal(result.occupation, "self-employed");
  assert.equal(result.income_mode, "bank");
});

test("terminal sessions do not continue the flow", () => {
  const session = createSession();
  const result = say(session, "I am busy.");
  const after = say(session, "Yes, this is me.");
  assert.equal(after.status, "callback_requested");
  assert.equal(after.reply, result.reply);
});

test("joint ownership and industrial property are eligible field values", () => {
  const answers = {
    property_type: "industrial",
    ownership_status: "joint",
    original_documents_available: true,
    loan_amount_inr: 7500000,
    occupation: "self-employed",
    income_mode: "bank",
    property_market_value_inr: 12000000,
    tenure_years: 15
  };
  assert.equal(allEligible(answers), true);
  assert.equal(findDisqualification(answers), null);
});

test("Hindi configuration returns a Hindi opening", () => {
  const session = createSession({ customer_name: "Priya", language_to_speak: "Hindi" });
  assert.match(session.lastReply, /नमस्ते/);
});
