// Rule-based conversation agent used when no model credential is configured.
//
// It is deliberately adaptive rather than scripted: it parses dates, addresses, yes/no and
// hedging from free-form answers, asks follow-ups when something is missing, and records an
// issue as unresolved when the client cannot answer. It is labelled "Demo mode" in the UI.

import type { Clarification, ClarificationFinding, ConverseRequest, ConverseResponse, Issue } from "@/lib/types";
import { attorneyParts } from "@/lib/firm";

// ---------------- utterance parsing ----------------
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_ABBR: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

interface ParsedDate {
  month: number;
  day?: number;
  year?: number;
  text: string;
}

function parseDates(s: string): ParsedDate[] {
  const out: ParsedDate[] = [];
  const re = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?\s*(\d{1,2}(?!\d))?(?:st|nd|rd|th)?,?\s*(\d{4})?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const key = m[1].toLowerCase().slice(0, 3);
    const month = MONTH_ABBR[key] ?? MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) continue;
    const day = m[2] ? parseInt(m[2], 10) : undefined;
    const year = m[3] ? parseInt(m[3], 10) : undefined;
    out.push({ month, day, year, text: m[0].trim() });
  }
  // Numeric forms like 1/15/2024 or 2024-01-15
  const num = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
  while ((m = num.exec(s))) {
    out.push({ month: parseInt(m[1], 10) - 1, day: parseInt(m[2], 10), year: parseInt(m[3].length === 2 ? "20" + m[3] : m[3], 10), text: m[0] });
  }
  return out;
}

function fmtDate(d: ParsedDate, defaultYear = 2024): string {
  const name = MONTHS[d.month][0].toUpperCase() + MONTHS[d.month].slice(1);
  return d.day ? `${name} ${d.day}, ${d.year ?? defaultYear}` : `${name} ${d.year ?? defaultYear}`;
}

/** "March 1, 2024" → "February 29, 2024" (used to close a contractor period the day before full-time start). */
function dayBefore(dateStr: string): string {
  const d = parseDates(dateStr)[0];
  if (!d || !d.day) return `the day before ${dateStr}`;
  const dt = new Date(d.year ?? 2024, d.month, d.day - 1);
  return `${MONTHS[dt.getMonth()][0].toUpperCase()}${MONTHS[dt.getMonth()].slice(1)} ${dt.getDate()}, ${dt.getFullYear()}`;
}

const CITY_STATE: Record<string, string> = { atlanta: "GA", marietta: "GA", decatur: "GA", austin: "TX", dallas: "TX", houston: "TX", chicago: "IL", "new york": "NY", boston: "MA", seattle: "WA", "san francisco": "CA", "los angeles": "CA", "san jose": "CA", denver: "CO", miami: "FL", nashville: "TN", charlotte: "NC", raleigh: "NC", phoenix: "AZ", philadelphia: "PA" };

const STATES: Record<string, string> = {
  al: "AL", alabama: "AL", ak: "AK", alaska: "AK", az: "AZ", arizona: "AZ", ar: "AR", arkansas: "AR", ca: "CA", california: "CA", co: "CO", colorado: "CO", ct: "CT", connecticut: "CT", de: "DE", delaware: "DE", fl: "FL", florida: "FL", ga: "GA", georgia: "GA", hi: "HI", hawaii: "HI", id: "ID", idaho: "ID", il: "IL", illinois: "IL", in: "IN", indiana: "IN", ia: "IA", iowa: "IA", ks: "KS", kansas: "KS", ky: "KY", kentucky: "KY", la: "LA", louisiana: "LA", me: "ME", maine: "ME", md: "MD", maryland: "MD", ma: "MA", massachusetts: "MA", mi: "MI", michigan: "MI", mn: "MN", minnesota: "MN", ms: "MS", mississippi: "MS", mo: "MO", missouri: "MO", mt: "MT", montana: "MT", ne: "NE", nebraska: "NE", nv: "NV", nevada: "NV", nh: "NH", nj: "NJ", "new jersey": "NJ", nm: "NM", "new mexico": "NM", ny: "NY", "new york": "NY", nc: "NC", "north carolina": "NC", nd: "ND", "north dakota": "ND", oh: "OH", ohio: "OH", ok: "OK", oklahoma: "OK", or: "OR", oregon: "OR", pa: "PA", pennsylvania: "PA", ri: "RI", "rhode island": "RI", sc: "SC", "south carolina": "SC", sd: "SD", "south dakota": "SD", tn: "TN", tennessee: "TN", tx: "TX", texas: "TX", ut: "UT", utah: "UT", vt: "VT", vermont: "VT", va: "VA", virginia: "VA", wa: "WA", washington: "WA", wv: "WV", "west virginia": "WV", wi: "WI", wisconsin: "WI", wy: "WY", wyoming: "WY", dc: "DC",
};

interface ParsedAddress {
  street?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
}

function parseAddress(s: string): ParsedAddress {
  const out: ParsedAddress = {};
  const street =
    /\b(\d{1,6}[a-z]?\s+(?:[a-z0-9.'-]+\s+){0,4}?(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct|place|pl|circle|cir|terrace|ter|walk|parkway|pkwy|highway|hwy|trail|trl|square|sq|loop|run|path|row|alley|plaza)\b\.?(?:\s+(?:ne|nw|se|sw|north|south|east|west))?)/i.exec(
      s,
    );
  if (street) out.street = street[1].replace(/\s+/g, " ").trim();
  const unit = /\b(?:apt|apartment|unit|suite|ste|#)\s*\.?\s*([a-z0-9-]+)\b/i.exec(s);
  if (unit) out.unit = unit[0].replace(/\s+/g, " ").trim();
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(s.replace(street?.[0] ?? "", ""));
  if (zip) out.zip = zip[1];
  // city, state
  const KNOWN = /\b(atlanta|austin|dallas|houston|chicago|new york|boston|seattle|san francisco|los angeles|denver|miami|nashville|charlotte|phoenix|san jose|philadelphia|raleigh|marietta|decatur)\b/i;
  const titleCase = (w: string) => w.split(" ").map((x) => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(" ");
  const cs = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*,\s*([A-Za-z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/.exec(s);
  const known = KNOWN.exec(s);
  if (cs && STATES[cs[2].toLowerCase()]) {
    out.city = cs[1];
    out.state = STATES[cs[2].toLowerCase()];
  } else if (known) {
    out.city = titleCase(known[1]);
  } else {
    // "in Atlanta, Georgia" / "in atlanta georgia" / "in Atlanta" — skip "at my cousin's", "in the", etc.
    const STOP = /^(the|my|a|an|his|her|their|our|this|that|some|with|for|about|from|and|which|it|there|here|home|town|college|school|work)$/i;
    const re = /\b(?:in|at|to)\s+([A-Za-z]+(?:\s[A-Za-z]+)?)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const words = m[1].split(" ");
      if (STOP.test(words[0]) || STATES[words[0].toLowerCase()]) continue;
      const cand = STOP.test(words[1] ?? "") || /'s$/.test(words[1] ?? "") ? words[0] : m[1];
      out.city = titleCase(cand);
      break;
    }
  }
  const words = s.toLowerCase().split(/[^a-z]+/);
  for (let i = 0; i < words.length && !out.state; i++) {
    const two = `${words[i]} ${words[i + 1] ?? ""}`.trim();
    if (STATES[two] && two.includes(" ")) out.state = STATES[two];
    else if (STATES[words[i]] && words[i].length > 2) out.state = STATES[words[i]];
  }
  if (out.city && !out.state && CITY_STATE[out.city.toLowerCase()]) out.state = CITY_STATE[out.city.toLowerCase()];
  return out;
}

const UNSURE = /\b(not sure|don'?t remember|do not remember|can'?t recall|cannot recall|no idea|unsure|don'?t know|do not know|not certain|can'?t remember|i'?d have to check|would have to check|let me check|i forget)\b/i;
const YES = /^\s*(yes|yeah|yep|yup|correct|right|that'?s right|that is right|exactly|sure|absolutely|it did|i did|true|of course|mm-?hmm|uh-?huh)\b/i;
const NO = /^\s*(no|nope|never|that'?s wrong|that'?s not right|incorrect|i didn'?t|it didn'?t|i never|not really)\b/i;
const REPEAT = /\b(repeat|say that again|what was the question|pardon|sorry\??$|come again|didn'?t catch)\b/i;

function upd(issueId: string, status: Clarification["status"], clientStatement: string, findings: ClarificationFinding[], proposedResolution: string, notes?: string): Clarification {
  return { issueId, status, clientStatement, findings, proposedResolution, notes, updatedAt: new Date().toISOString() };
}

function mergeFindings(prev: ClarificationFinding[] | undefined, next: ClarificationFinding[]): ClarificationFinding[] {
  const map = new Map<string, string>();
  for (const f of prev ?? []) map.set(f.label, f.value);
  for (const f of next) map.set(f.label, f.value);
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

function joinStatement(prev: string | undefined, next: string): string {
  const n = next.trim();
  if (!prev) return n;
  return `${prev} · ${n}`;
}

type Topic = "employment" | "address" | "travel" | "generic";
function topicOf(issue: Issue): Topic {
  const s = `${issue.id} ${issue.title}`.toLowerCase();
  if (/employ|job|work|start date|contract/.test(s)) return "employment";
  if (/address|resid|gap|lived|housing/.test(s)) return "address";
  if (/travel|trip|visit|countr/.test(s)) return "travel";
  return "generic";
}

interface StepResult {
  speech: string;
  update?: Clarification;
  done: boolean; // this issue is finished (resolved or unresolved)
}

// ---------------- per-topic handlers ----------------
function stepEmployment(issue: Issue, prev: Clarification | undefined, u: string): StepResult {
  const dates = parseDates(u);
  const contractor = /\b(contract(?:or|ing|ed)?|consult(?:ant|ing)?|1099|freelanc\w*|part[- ]time|temp(?:orary)?)\b/i.test(u);
  const fulltime = /\b(full[- ]?time|w-?2|employee|permanent|convert\w*|hired|official(?:ly)?|payroll|salaried)\b/i.test(u);
  // A month without a day ("mid January", "start of March") is taken to confirm the documented date.
  const janRaw = dates.find((d) => d.month === 0);
  const marRaw = dates.find((d) => d.month === 2);
  const jan = janRaw ? (janRaw.day ? janRaw : { ...janRaw, day: 15, year: janRaw.year ?? 2024 }) : undefined;
  const mar = marRaw ? (marRaw.day ? marRaw : { ...marRaw, day: 1, year: marRaw.year ?? 2024 }) : undefined;
  const awaiting = prev?.notes?.startsWith("Awaiting:") ? prev.notes : undefined;

  if (UNSURE.test(u) && !contractor && dates.length === 0) {
    return {
      speech: "That's okay — I'll note that you weren't certain, and the attorney will follow up on the employment dates separately. ",
      update: upd(issue.id, "unresolved", joinStatement(prev?.clientStatement, `Client was not sure about the start-date timeline: "${u}"`), prev?.findings ?? [], "Unresolved — client could not confirm the employment timeline on the call. Attorney to follow up with employer HR.", "Client unsure on call"),
      done: true,
    };
  }

  if (awaiting === "Awaiting: full-time start date") {
    if (mar || fulltime || YES.test(u)) {
      const ft = mar ? fmtDate(mar) : "March 1, 2024";
      const findings = mergeFindings(prev?.findings, [{ label: "Full-time employment start", value: ft }]);
      return {
        speech: `Thank you. I've recorded contractor work from ${findings.find((f) => f.label === "Contractor start")?.value ?? "January 15, 2024"} and full-time employment from ${ft}. `,
        update: upd(issue.id, "resolved", joinStatement(prev?.clientStatement, u), findings, `Record ${findings.find((f) => f.label === "Contractor start")?.value ?? "January 15, 2024"} – ${dayBefore(ft)} as an independent-contractor engagement with Northstar; preserve ${ft} as the full-time employment start date.`),
        done: true,
      };
    }
    if (dates.length) {
      const ft = fmtDate(dates[0]);
      const findings = mergeFindings(prev?.findings, [{ label: "Full-time employment start", value: ft }]);
      return {
        speech: `Understood — full-time from ${ft}. Just to flag, the application and your employer's letter both list March 1, 2024; the attorney will reconcile that with you. `,
        update: upd(issue.id, "partial", joinStatement(prev?.clientStatement, u), findings, `Client states full-time employment began ${ft}, which differs from the March 1, 2024 date in the DS-160 and employer letter. Attorney to confirm the correct full-time start with the employer.`, "Client date differs from documents"),
        done: true,
      };
    }
    return { speech: "Sorry, I didn't catch a date. When did you move from contractor to full-time employee at Northstar?", done: false };
  }

  if (awaiting === "Awaiting: nature of January relationship") {
    if (contractor) {
      const findings = mergeFindings(prev?.findings, [{ label: "Relationship in January 2024", value: "Independent contractor" }, { label: "Contractor start", value: jan ? fmtDate(jan) : "January 15, 2024" }]);
      if (mar || fulltime) {
        const ft = mar ? fmtDate(mar) : "March 1, 2024";
        const all = mergeFindings(findings, [{ label: "Full-time employment start", value: ft }]);
        return { speech: `Got it — contractor from ${all[1].value}, full-time from ${ft}. `, update: upd(issue.id, "resolved", joinStatement(prev?.clientStatement, u), all, `Record ${all[1].value} – ${dayBefore(ft)} as an independent-contractor engagement with Northstar; preserve ${ft} as the full-time employment start date.`), done: true };
      }
      return { speech: "Thanks. And when did that convert to full-time employment?", update: upd(issue.id, "partial", joinStatement(prev?.clientStatement, u), findings, "Pending full-time start date.", "Awaiting: full-time start date"), done: false };
    }
    if (fulltime || YES.test(u)) {
      const findings = mergeFindings(prev?.findings, [{ label: "Client-stated full-time start", value: jan ? fmtDate(jan) : "January 15, 2024" }]);
      return {
        speech: "Understood. That differs from the March 1 date on the application and in your employer's letter, so I'll flag it for the attorney to confirm with Northstar. ",
        update: upd(issue.id, "partial", joinStatement(prev?.clientStatement, u), findings, "Client states full-time employment began in January 2024, which conflicts with the DS-160 and employer letter (March 1, 2024). Attorney to confirm with employer before correcting.", "Client disagrees with employer letter"),
        done: true,
      };
    }
    return { speech: "Was the work you did for Northstar in January as a contractor, or were you a full-time employee from the start?", done: false };
  }

  // First answer on this issue
  if (contractor) {
    const cs = jan ? fmtDate(jan) : "January 15, 2024";
    const findings: ClarificationFinding[] = [{ label: "Relationship in January 2024", value: "Independent contractor" }, { label: "Contractor start", value: cs }];
    if (mar || fulltime) {
      const ft = mar ? fmtDate(mar) : "March 1, 2024";
      findings.push({ label: "Full-time employment start", value: ft });
      return {
        speech: `Thank you, that clears it up. So to confirm: contractor work from ${cs}, and full-time employment from ${ft}. `,
        update: upd(issue.id, "resolved", u, findings, `Record ${cs} – ${dayBefore(ft)} as an independent-contractor engagement with Northstar Systems LLC; preserve ${ft} as the full-time employment start date on the application.`),
        done: true,
      };
    }
    return { speech: `Thanks. So you started as a contractor around ${cs}. When did that convert to full-time employment?`, update: upd(issue.id, "partial", u, findings, "Pending full-time start date.", "Awaiting: full-time start date"), done: false };
  }
  if (jan && !mar) {
    return { speech: `Okay, so ${jan.day ? fmtDate(jan) : "January"}. Was that as a full-time employee from the start, or in another capacity, such as a contractor?`, update: upd(issue.id, "partial", u, [{ label: "Client-stated start", value: fmtDate(jan) }], "Pending nature of January relationship.", "Awaiting: nature of January relationship"), done: false };
  }
  if (mar && !jan) {
    return { speech: "Understood, March 1 as the employment start. How should we understand the January 15 date on your resume — were you doing any work for Northstar before March?", update: upd(issue.id, "partial", u, [{ label: "Full-time employment start", value: fmtDate(mar) }], "Pending explanation of January date.", "Awaiting: nature of January relationship"), done: false };
  }
  if (fulltime && !contractor) {
    return { speech: "Okay. Which date is your full-time start — January 15 or March 1, 2024?", update: upd(issue.id, "partial", u, [], "Pending.", "Awaiting: nature of January relationship"), done: false };
  }
  return { speech: "Just so I record this correctly: were you working with Northstar as a contractor before becoming a full-time employee, or is one of the dates on your documents a mistake?", done: false };
}

function stepAddress(issue: Issue, prev: Clarification | undefined, u: string): StepResult {
  const addr = parseAddress(u);
  const dates = parseDates(u);
  const awaiting = prev?.notes?.startsWith("Awaiting:") ? prev.notes : undefined;
  const prevF = Object.fromEntries((prev?.findings ?? []).map((f) => [f.label, f.value]));
  const withWhom = /\b(with|at)\s+(my|a|an)\s+([a-z]+(?:'s)?)\b/i.exec(u);
  const arrangement = /\b(sublet|sublease|airbnb|hotel|friend|cousin|parent|family|brother|sister|aunt|uncle|roommate|temporar\w+|short[- ]term|corporate housing|staying with|stayed with|crash\w*)\b/i.test(u)
    ? withWhom
      ? `Stayed ${withWhom[1]} ${withWhom[2]} ${withWhom[3]}`
      : "Temporary arrangement"
    : undefined;

  if (UNSURE.test(u) && !addr.street && !addr.city) {
    return {
      speech: "No problem. I'll record that the January to April 2024 address still needs to be confirmed, and the attorney will follow up with you by email. ",
      update: upd(issue.id, "unresolved", joinStatement(prev?.clientStatement, u), prev?.findings ?? [], "Unresolved — client could not provide the January 1 – April 30, 2024 residence on the call. Attorney to request the address in writing.", "Client unsure on call"),
      done: true,
    };
  }

  const findings: ClarificationFinding[] = [];
  if (addr.street) findings.push({ label: "Street address", value: addr.unit ? `${addr.street}, ${addr.unit}` : addr.street });
  else if (addr.unit && prevF["Street address"] && !prevF["Street address"].includes(addr.unit)) findings.push({ label: "Street address", value: `${prevF["Street address"]}, ${addr.unit}` });
  if (addr.city) findings.push({ label: "City", value: addr.city });
  if (addr.state) findings.push({ label: "State", value: addr.state });
  if (addr.zip) findings.push({ label: "ZIP", value: addr.zip });
  if (arrangement && !prevF["Arrangement"]) findings.push({ label: "Arrangement", value: arrangement });
  if (dates.length >= 2) findings.push({ label: "Dates", value: `${fmtDate(dates[0])} – ${fmtDate(dates[1])}` });
  else if (dates.length === 1 && /\b(from|since|starting)\b/i.test(u)) findings.push({ label: "Dates", value: `From ${fmtDate(dates[0])}` });

  const merged = mergeFindings(prev?.findings, findings);
  const f = Object.fromEntries(merged.map((x) => [x.label, x.value]));

  if (awaiting === "Awaiting: date confirmation") {
    if (YES.test(u) || /\b(whole|entire|full|all)\b/i.test(u) || dates.length >= 2) {
      const dateStr = dates.length >= 2 && (dates[0].day || dates[1].day) ? `${fmtDate(dates[0])} – ${fmtDate(dates[1])}` : dates.length >= 2 ? `${fmtDate(dates[0])} – ${fmtDate(dates[1])}` : "January 1 – April 30, 2024";
      const all = mergeFindings(merged, [{ label: "Dates", value: dateStr }]);
      const line = `${f["Street address"] ?? ""}${f["City"] ? `, ${f["City"]}` : ""}${f["State"] ? `, ${f["State"]}` : ""}${f["ZIP"] ? ` ${f["ZIP"]}` : ""}`.trim();
      return { speech: `Thank you. I've recorded ${line} for ${dateStr}. `, update: upd(issue.id, "resolved", joinStatement(prev?.clientStatement, u), all, `Add residence ${line} (${dateStr}) to the address history so it is continuous from December 31, 2023 to May 1, 2024.`), done: true };
    }
    if (NO.test(u) && dates.length === 0) {
      return { speech: "Okay. What dates were you at that address?", update: upd(issue.id, "partial", joinStatement(prev?.clientStatement, u), merged, "Pending dates.", "Awaiting: date confirmation"), done: false };
    }
  }

  const haveStreet = !!f["Street address"];
  const haveCity = !!f["City"];
  const haveState = !!f["State"];
  const stmt = joinStatement(prev?.clientStatement, u);

  if (haveStreet && haveCity) {
    const line = `${f["Street address"]}, ${f["City"]}${haveState ? `, ${f["State"]}` : ""}${f["ZIP"] ? ` ${f["ZIP"]}` : ""}`;
    if (f["Dates"]) {
      return { speech: `Thank you. I've recorded ${line} for ${f["Dates"]}. `, update: upd(issue.id, "resolved", stmt, merged, `Add residence ${line} (${f["Dates"]}) to the address history.`), done: true };
    }
    return { speech: `Got it — ${line}. Was that for the whole period, from January through the end of April 2024?`, update: upd(issue.id, "partial", stmt, merged, "Pending dates.", "Awaiting: date confirmation"), done: false };
  }
  if (haveStreet && !haveCity) {
    return { speech: "Thanks. And which city and state is that in?", update: upd(issue.id, "partial", stmt, merged, "Pending city and state.", "Awaiting: city"), done: false };
  }
  if (!haveStreet && (haveCity || arrangement)) {
    const where = haveCity ? `in ${f["City"]}${haveState ? `, ${f["State"]}` : ""}` : "there";
    return { speech: `Understood, ${arrangement ? arrangement.toLowerCase() + " " : ""}${where}. For the record I'll need the street address, including any apartment number. What was the full address?`, update: upd(issue.id, "partial", stmt, merged, "Pending street address.", "Awaiting: street"), done: false };
  }
  return { speech: "I'll need a full address for that period — the street, apartment number if any, city and state. Where were you living from January through April 2024?", done: false };
}

function stepTravel(issue: Issue, prev: Clarification | undefined, u: string): StepResult {
  const dates = parseDates(u);
  const awaiting = prev?.notes?.startsWith("Awaiting:") ? prev.notes : undefined;
  const mentionsUK = /\b(uk|u\.k\.|united kingdom|london|england|britain|heathrow)\b/i.test(u);
  const purposeM = /\b(vacation|holiday|wedding|honeymoon|tourism|tourist|sightseeing|visit(?:ing|ed)?\s+(?:a\s+|my\s+)?(?:friend|family|cousin|sister|brother|parents?|relatives?)|friend'?s?\s+wedding|conference|business|work trip|interview|training|personal)\b/i.exec(u);
  const purpose = purposeM ? purposeM[0].charAt(0).toUpperCase() + purposeM[0].slice(1).toLowerCase() : undefined;
  const prevF = Object.fromEntries((prev?.findings ?? []).map((f) => [f.label, f.value]));

  if (UNSURE.test(u) && !purpose && !YES.test(u)) {
    return {
      speech: "Understood. I'll mark the February 2024 UK trip as needing confirmation, and the attorney will follow up with your passport stamps. ",
      update: upd(issue.id, "unresolved", joinStatement(prev?.clientStatement, u), prev?.findings ?? [], "Unresolved — client could not confirm the February 14–21, 2024 UK trip on the call. Attorney to verify against passport entry/exit stamps.", "Client unsure on call"),
      done: true,
    };
  }

  if (awaiting === "Awaiting: denial reconsideration") {
    if (NO.test(u) || /\b(never|didn'?t|did not|wasn'?t|mistake|wrong)\b/i.test(u)) {
      return {
        speech: "Okay. I've recorded that you don't believe that trip took place, and the attorney will reconcile that with the stamp record before anything is changed. ",
        update: upd(issue.id, "unresolved", joinStatement(prev?.clientStatement, u), [{ label: "Client position", value: "Denies the February 2024 UK trip" }], "Unresolved — client disputes the UK trip that the travel record and stamp detail show. Attorney to verify against the physical passport before deciding whether to add the trip.", "Client disputes document"),
        done: true,
      };
    }
    // fell through to acknowledging the trip
  }

  const reversal = /\b(oh wait|actually|now that you mention|i forgot|slipped my mind|oh right|you'?re right)\b/i.test(u);
  const denial = (NO.test(u) || /\b(never|didn'?t|did not|no trip|wasn'?t there)\b/i.test(u)) && !YES.test(u) && !reversal;
  const occurred = !denial && (YES.test(u) || mentionsUK || !!purpose || reversal || /\b(went|did go|took|travel(?:l)?ed|i did)\b/i.test(u));
  if (denial) {
    return {
      speech: "I understand. The record I have includes a UK Border Force entry stamp dated 15 February 2024 and a return to Atlanta on the 21st. Could the trip have been overlooked, or do you believe the record is wrong?",
      update: upd(issue.id, "partial", u, [{ label: "Client position", value: "Initially denied the trip" }], "Pending reconsideration.", "Awaiting: denial reconsideration"),
      done: false,
    };
  }

  if (occurred) {
    const findings: ClarificationFinding[] = [{ label: "Trip occurred", value: "Yes — London, United Kingdom" }];
    if (purpose) findings.push({ label: "Purpose", value: purpose });
    if (dates.length >= 2) findings.push({ label: "Dates (client)", value: `${fmtDate(dates[0])} – ${fmtDate(dates[1])}` });
    const merged = mergeFindings(prev?.findings, findings);
    const mf = Object.fromEntries(merged.map((x) => [x.label, x.value]));
    const stmt = joinStatement(prev?.clientStatement, u);
    if (mf["Purpose"]) {
      const dateStr = mf["Dates (client)"] ?? "February 14 – 21, 2024";
      return {
        speech: `Thank you. I've recorded the trip to London, ${dateStr}, ${mf["Purpose"].toLowerCase()}. `,
        update: upd(issue.id, "resolved", stmt, mergeFindings(merged, [{ label: "Dates", value: dateStr }]), `Add United Kingdom to the countries visited in the last five years on the application, with travel dates ${dateStr} (${mf["Purpose"].toLowerCase()}).`),
        done: true,
      };
    }
    return { speech: "Thanks for confirming. What was the purpose of that trip?", update: upd(issue.id, "partial", stmt, merged, "Pending purpose of travel.", "Awaiting: purpose"), done: false };
  }
  if (awaiting === "Awaiting: purpose" && u.trim().split(/\s+/).length >= 1 && !REPEAT.test(u)) {
    // Accept a free-form purpose the regex did not recognise.
    const p = u.trim().replace(/^(it was|i was|to|for)\s+/i, "");
    const merged = mergeFindings(prev?.findings, [{ label: "Purpose", value: p.charAt(0).toUpperCase() + p.slice(1) }]);
    return {
      speech: `Understood. I've recorded the trip to London, February 14 to 21, 2024, for ${p}. `,
      update: upd(issue.id, "resolved", joinStatement(prev?.clientStatement, u), mergeFindings(merged, [{ label: "Dates", value: "February 14 – 21, 2024" }]), `Add United Kingdom to the countries visited on the application, with travel dates February 14 – 21, 2024 (${p}).`),
      done: true,
    };
  }
  if (!prevF["Trip occurred"]) {
    const note = /\b(mistake|wrong|error)\b/i.test(u) ? " " : " ";
    return { speech: `${note}Just to be clear — did you travel to the United Kingdom in February 2024?`.trim(), done: false };
  }
  return { speech: "Sorry, I didn't catch that. What was the purpose of the London trip?", done: false };
}

function stepGeneric(issue: Issue, prev: Clarification | undefined, u: string): StepResult {
  if (UNSURE.test(u)) {
    return { speech: "Understood — I'll note that this still needs to be confirmed and the attorney will follow up. ", update: upd(issue.id, "unresolved", joinStatement(prev?.clientStatement, u), [], `Unresolved — client could not clarify "${issue.title}" on the call.`, "Client unsure on call"), done: true };
  }
  if (u.trim().split(/\s+/).length < 3 && !YES.test(u) && !NO.test(u)) {
    return { speech: "Could you tell me a little more about that?", done: false };
  }
  return { speech: "Thank you, I've noted that for the attorney to review. ", update: upd(issue.id, "resolved", joinStatement(prev?.clientStatement, u), [{ label: "Client statement", value: u.trim() }], `Client stated: "${u.trim()}". Attorney to apply the appropriate correction.`), done: true };
}

// ---------------- orchestration ----------------
function demoConverseInner(req: ConverseRequest): Omit<ConverseResponse, "reasoning"> {
  const rank = new Map((req.plan ?? []).map((p, i) => [p.issueId, i]));
  const contactIssues = req.issues.filter((i) => i.requiresClientContact).sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  const rec = new Map(req.clarifications.map((c) => [c.issueId, c]));
  const isOpen = (i: Issue) => {
    const c = rec.get(i.id);
    return !c || c.status === "partial";
  };
  const who = attorneyParts(req.caseSummary.attorney);
  const firstName = req.caseSummary.clientName.split(" ")[0];
  const caseShort = req.caseSummary.caseType.split("·")[0].trim();

  const nextOpen = (): Issue | undefined => contactIssues.find(isOpen);
  // Evidence gaps are asked after the issues, one at a time, and recorded on "evidence:<item>".
  const evidenceAsk = (req.evidenceChecklist ?? []).filter((e) => e.status !== "present" && e.askClient && e.question);
  const nextEvidence = () => evidenceAsk.find((e) => !rec.has(`evidence:${e.item}`));

  // Opening turn (a null utterance with a document event is handled below as an interruption):
  // a short, warm greeting that asks whether now is a good time. The first question waits for the answer.
  if (req.clientUtterance === null && !req.event) {
    const first = nextOpen();
    if (!first) {
      return { speech: `Hi ${firstName}, this is the case assistant calling on behalf of ${who.onBehalfOf}. It looks like there's nothing open on your file right now, so I won't keep you. Have a good day!`, focusIssueId: null, updates: [], endCall: true, engine: "demo" };
    }
    return {
      speech: `Hi, is this ${firstName}? I'm calling on behalf of ${who.onBehalfOf} — I have a few quick questions about your ${caseShort} file, if you have a couple of minutes?`,
      focusIssueId: first.id,
      updates: [],
      endCall: false,
      engine: "demo",
    };
  }

  const u = (req.clientUtterance ?? "").trim();
  const current = nextOpen();

  // The reply to the greeting: a yes (or a bad time) rather than an answer. A substantive first reply
  // ("I was contracting first…") falls through and is treated as the answer to the first question.
  const isReplyToGreeting = req.transcript.filter((t) => t.role === "agent").length === 1 && req.clarifications.length === 0 && !req.event;
  if (isReplyToGreeting && current) {
    const busy = /\b(bad time|not a good time|busy|can'?t (talk|right now)|call (me )?back|later|another time|in a meeting|driving)\b/i.test(u);
    const consent = YES.test(u) || /\b(go ahead|sure|okay|ok|fine|speaking|this is (she|her|maya)|that'?s me|i have (a few|some|a couple)|of course|no problem)\b/i.test(u);
    if (busy) {
      return {
        speech: `No problem at all — I'll let ${who.person ?? "the office"} know and we'll try you another time. Take care, ${firstName}.`,
        focusIssueId: null,
        updates: [],
        endCall: true,
        engine: "demo",
      };
    }
    if (consent && u.length < 60 && !/\d/.test(u)) {
      return {
        speech: `Great, thank you. ${current.suggestedQuestion}`,
        focusIssueId: current.id,
        updates: [],
        endCall: false,
        engine: "demo",
      };
    }
  }
  if (req.event?.type === "document_received") {
    const cont = current ? ` Coming back to my question: ${current.suggestedQuestion}` : "";
    return {
      speech: `Thank you, I've received ${req.event.docName.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ")} and attached it to your file for the attorney to review.${cont}`,
      focusIssueId: current?.id ?? null,
      updates: [],
      endCall: false,
      engine: "demo",
    };
  }
  if (!current) {
    const ev = nextEvidence();
    if (!ev) {
      return { speech: "Thanks again for your time — the attorney will review everything before any change is made. Goodbye.", focusIssueId: null, updates: [], endCall: true, engine: "demo" };
    }
    // Interpret the answer to the pending evidence question.
    const has = YES.test(u) || /\b(have|got|kept|yes|can get|can send|with my employer|hr has)\b/i.test(u);
    const lacks = NO.test(u) || UNSURE.test(u) || /\b(don'?t have|lost|threw|never got|not sure)\b/i.test(u);
    const update = upd(`evidence:${ev.item}`, has && !lacks ? "resolved" : "unresolved", u, [{ label: "Client has it", value: has && !lacks ? "Yes" : "No / unsure" }], has && !lacks ? `Client can supply: ${ev.item}.` : `Client cannot readily supply: ${ev.item}. Attorney to obtain another way.`);
    rec.set(update.issueId, update);
    const following = nextEvidence();
    if (following) {
      return { speech: `${has && !lacks ? "Great, I've noted that." : "Understood, I've noted that for the attorney."} Next: ${following.question}`, focusIssueId: `evidence:${following.item}`, updates: [update], endCall: false, engine: "demo" };
    }
    return {
      speech: `${has && !lacks ? "Great, I've noted that." : "Understood, I've noted that for the attorney."} That's everything I needed. Nothing changes on your case until your attorney reviews these notes. Thank you for your time, ${firstName} — goodbye.`,
      focusIssueId: null,
      updates: [update],
      endCall: true,
      engine: "demo",
    };
  }

  if (/\b(bye|goodbye|have to go|gotta go|need to go|talk later|hang up)\b/i.test(u)) {
    return {
      speech: `Of course. Nothing changes on your case until your attorney reviews these notes, and we'll follow up on anything still open. Thank you for your time, ${firstName} — goodbye.`,
      focusIssueId: null,
      updates: [],
      endCall: true,
      engine: "demo",
    };
  }
  if (REPEAT.test(u) || u.length === 0) {
    const prev = rec.get(current.id);
    const q = prev?.notes?.startsWith("Awaiting:") ? `Of course. ${prev.notes.replace("Awaiting: ", "I still need the ")}.` : `Of course. ${current.suggestedQuestion}`;
    return { speech: q, focusIssueId: current.id, updates: [], endCall: false, engine: "demo" };
  }

  const prev = rec.get(current.id);
  const topic = topicOf(current);
  const step =
    topic === "employment" ? stepEmployment(current, prev, u) : topic === "address" ? stepAddress(current, prev, u) : topic === "travel" ? stepTravel(current, prev, u) : stepGeneric(current, prev, u);

  const updates = step.update ? [step.update] : [];
  if (!step.done) {
    return { speech: step.speech, focusIssueId: current.id, updates, endCall: false, engine: "demo" };
  }

  // Issue finished — move on or wrap up.
  if (step.update) rec.set(current.id, step.update);
  const following = contactIssues.find((i) => i.id !== current.id && isOpen(i));
  if (following) {
    return { speech: `${step.speech.trim()} Next: ${following.suggestedQuestion}`, focusIssueId: following.id, updates, endCall: false, engine: "demo" };
  }
  const firstEvidence = nextEvidence();
  if (firstEvidence) {
    return { speech: `${step.speech.trim()} A couple of quick questions about documents the consulate may ask for. ${firstEvidence.question}`, focusIssueId: `evidence:${firstEvidence.item}`, updates, endCall: false, engine: "demo" };
  }
  const shortLabel = (i: Issue) => {
    const t = topicOf(i);
    if (t === "employment") return "your employment timeline with Northstar";
    if (t === "address") return "your address for January through April 2024";
    if (t === "travel") return "the February 2024 UK trip";
    return i.title.toLowerCase();
  };
  const recorded = contactIssues.filter((i) => rec.get(i.id)?.status === "resolved").map(shortLabel);
  const flagged = contactIssues.filter((i) => rec.get(i.id) && rec.get(i.id)!.status !== "resolved").map(shortLabel);
  const recap: string[] = [];
  if (recorded.length) recap.push(`I've recorded ${recorded.join(", ")}`);
  if (flagged.length) recap.push(`I've flagged ${flagged.join(" and ")} for the attorney to follow up`);
  const recapText = recap.length ? ` To recap: ${recap.join(", and ")}.` : "";
  return {
    speech: `${step.speech.trim()} That's everything I needed.${recapText} Nothing changes on your case until your attorney reviews these notes. Thank you for your time, ${firstName} — goodbye.`,
    focusIssueId: null,
    updates,
    endCall: true,
    engine: "demo",
  };
}

/** Derives an audience-readable reasoning trace from what the rule engine decided. */
export function demoConverse(req: ConverseRequest): ConverseResponse {
  const res = demoConverseInner(req);
  const byId = new Map(req.issues.map((i) => [i.id, i]));
  const prevRec = new Map(req.clarifications.map((c) => [c.issueId, c]));
  const r: string[] = [];
  const u = (req.clientUtterance ?? "").trim();
  const nameOf = (id: string | null) => (id ? byId.get(id)?.title ?? (id.startsWith("evidence:") ? `evidence — ${id.slice(9)}` : id) : null);

  if (req.event?.type === "document_received") {
    r.push(`Document received mid-call: ${req.event.docName}`);
    r.push("Noted for the attorney's file; returning to the open question");
  } else if (req.clientUtterance === null) {
    const first = nameOf(res.focusIssueId);
    r.push(`${req.issues.filter((i) => i.requiresClientContact).length} issues need the client; plan orders them by impact on the filing`);
    r.push("Greeting first and checking it is a good time; no case questions until the client says so");
    if (first) r.push(`First item by plan order: ${first}`);
  } else if (req.transcript.filter((t) => t.role === "agent").length === 1 && req.clarifications.length === 0 && res.updates.length === 0 && !req.event) {
    r.push(`Client said: "${u.length > 90 ? u.slice(0, 87) + "…" : u}"`);
    if (res.endCall) r.push("Not a good time — ending politely; the attorney will be told to try again later");
    else r.push(`Client is free to talk — asking the first question: ${nameOf(res.focusIssueId) ?? ""}`);
  } else {
    r.push(`Client said: "${u.length > 90 ? u.slice(0, 87) + "…" : u}"`);
    for (const up of res.updates) {
      const issue = byId.get(up.issueId);
      const cite = issue?.evidence?.[0];
      if (cite) r.push(`Checked against ${cite.docName} › ${cite.section}: "${cite.quote.length > 70 ? cite.quote.slice(0, 67) + "…" : cite.quote}"`);
      const vals = up.findings.slice(0, 3).map((f) => `${f.label}: ${f.value}`).join("; ");
      const was = prevRec.get(up.issueId)?.status;
      if (up.status === "resolved") r.push(`${vals ? vals + " — " : ""}${issue?.title ?? up.issueId} resolved`);
      else if (up.status === "unresolved") r.push(`Client cannot settle this on the call — marking unresolved for the attorney`);
      else r.push(`${vals ? "Recorded " + vals + "; " : ""}${was ? "still" : "now"} missing a detail — following up before moving on`);
    }
    if (res.updates.length === 0 && !res.endCall) r.push("No new fact in that answer — restating the question");
    if (res.endCall) r.push("Everything answerable on the call is covered — recapping and closing");
    else {
      const next = nameOf(res.focusIssueId);
      const moved = res.updates.some((x) => x.status !== "partial" && x.issueId !== res.focusIssueId);
      if (next && moved) r.push(`Next by plan order: ${next}`);
    }
  }
  return { ...res, reasoning: r.slice(0, 5) };
}
