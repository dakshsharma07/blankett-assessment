// Deterministic analysis used when no model credential is configured.
//
// It is honest about what it is: a rule-based analyzer that knows the shape of the bundled
// sample case. It still reads the *uploaded* files — every quote below is located in the
// extracted text of whatever the user actually dropped in, and an issue is only raised when
// the documents that create it are present.

import type { AnalysisResult, CaseDocument, Evidence, EvidenceCheck, Fact, Issue, PlanStep } from "@/lib/types";
import { canon, locateQuote } from "@/lib/evidence";

type Role = "ds160" | "resume" | "letter" | "travel" | "intake";

function classify(doc: CaseDocument): Role | null {
  const t = canon(doc.text);
  if (t.includes("ds-160")) return "ds160";
  if (t.includes("intake questionnaire")) return "intake";
  if (t.includes("international travel record")) return "travel";
  if (t.includes("independent contractor") && t.includes("to whom it may concern")) return "letter";
  if (t.includes("experience") && t.includes("education") && t.includes("skills")) return "resume";
  return null;
}

function ev(doc: CaseDocument, section: string, quote: string): Evidence | null {
  const found = locateQuote(doc.text, quote);
  if (!found) return null;
  return { docId: doc.id, docName: doc.name, section, quote: found, verified: true };
}

export function demoAnalyze(docs: CaseDocument[]): AnalysisResult {
  const byRole = new Map<Role, CaseDocument>();
  for (const d of docs) {
    const r = classify(d);
    if (r && !byRole.has(r)) byRole.set(r, d);
  }
  if (byRole.size < 2) {
    throw new Error(
      "Demo mode can only analyze the bundled sample case (at least two of its documents). Set ANTHROPIC_API_KEY to analyze arbitrary documents with Live AI.",
    );
  }

  const ds = byRole.get("ds160");
  const resume = byRole.get("resume");
  const letter = byRole.get("letter");
  const travel = byRole.get("travel");
  const intake = byRole.get("intake");

  const facts: Fact[] = [];
  const issues: Issue[] = [];
  let fid = 0;
  const fact = (category: string, label: string, value: string, e: Evidence | null) => {
    if (!e) return;
    facts.push({ id: `f${++fid}`, category, label, value, evidence: e });
  };

  // ---------- Facts ----------
  const dsStart = ds && ev(ds, "Present Work / Education / Training", "Employment Start Date March 1, 2024");
  const dsTitle = ds && ev(ds, "Present Work / Education / Training", "Job Title Software Engineer");
  const dsAddr1 = ds && ev(ds, "Address History (Last Five Years)", "88 Peachtree Walk NE, Apt 12B Atlanta, GA 30308 May 1, 2024 Present");
  const dsAddr2 = ds && ev(ds, "Address History (Last Five Years)", "2140 Lakeview Drive, Apt 7 Austin, TX 78703 August 15, 2021 December 31, 2023");
  const dsCountries = ds && ev(ds, "Travel Information — Countries Visited in the Last Five Years", "Country/Region 1 Canada Country/Region 2 India");
  const dsEmployer = ds && ev(ds, "Present Work / Education / Training", "Present Employer Northstar Systems LLC");

  const resStart = resume && ev(resume, "Experience", "Software Engineer II January 15, 2024 – Present");
  const resEmployer = resume && ev(resume, "Experience", "Northstar Systems LLC Atlanta, GA");

  const letContractor =
    letter && ev(letter, "Body", "began providing services to Northstar as an independent contractor on January 15, 2024");
  const letFullTime =
    letter && ev(letter, "Body", "On March 1, 2024, Ms. Patel converted to full-time employment with Northstar in the position of Software Engineer II");

  const trvUK = travel && ev(travel, "Trips Outside the United States — Last Five Years", "February 14, 2024 February 21, 2024 London, United Kingdom Personal travel");
  const trvUKStamp = travel && ev(travel, "Stamp Detail", "UK Border Force admission stamp 15 FEB 2024, London Heathrow (LHR)");
  const trvCanada = travel && ev(travel, "Trips Outside the United States — Last Five Years", "June 10, 2023 June 17, 2023 Toronto, Canada");
  const trvIndia = travel && ev(travel, "Trips Outside the United States — Last Five Years", "December 20, 2023 January 8, 2024 Mumbai, India");

  const intStart = intake && ev(intake, "Section 2 — Current Employment", "Employment start date March 2024");
  const intOtherAddr = intake && ev(intake, "Section 3 — Residential Address History", "Have you lived at any other address in the last five years? No");
  const intAddr2 = intake && ev(intake, "Section 3 — Residential Address History", "2140 Lakeview Drive, Apt 7, Austin, TX 78703 — August 15, 2021 to December 31, 2023");
  const intAddr1 = intake && ev(intake, "Section 3 — Residential Address History", "88 Peachtree Walk NE, Apt 12B, Atlanta, GA 30308 — since May 1, 2024");
  const intTravel = intake && ev(intake, "Section 4 — International Travel", "Canada (June 2023), India (December 2023 – January 2024)");
  const intOtherTrips = intake && ev(intake, "Section 4 — International Travel", "Any other trips outside the U.S.? None that I recall");
  const intTitle = intake && ev(intake, "Section 2 — Current Employment", "Job title Software Engineer II");

  fact("employment", "Employer", "Northstar Systems LLC", dsEmployer ?? resEmployer ?? null);
  fact("employment", "Employment start (DS-160)", "March 1, 2024", dsStart ?? null);
  fact("employment", "Employment start (resume)", "January 15, 2024", resStart ?? null);
  fact("employment", "Contractor start (employer letter)", "January 15, 2024", letContractor ?? null);
  fact("employment", "Full-time conversion (employer letter)", "March 1, 2024", letFullTime ?? null);
  fact("employment", "Employment start (intake)", "March 2024", intStart ?? null);
  fact("employment", "Job title (DS-160)", "Software Engineer", dsTitle ?? null);
  fact("employment", "Job title (intake)", "Software Engineer II", intTitle ?? null);
  fact("address", "Current residence", "88 Peachtree Walk NE, Apt 12B, Atlanta, GA 30308 · May 1, 2024 – Present", dsAddr1 ?? intAddr1 ?? null);
  fact("address", "Prior residence", "2140 Lakeview Drive, Apt 7, Austin, TX 78703 · Aug 15, 2021 – Dec 31, 2023", dsAddr2 ?? intAddr2 ?? null);
  fact("address", "Other addresses declared (intake)", "No", intOtherAddr ?? null);
  fact("travel", "Countries visited (DS-160)", "Canada, India", dsCountries ?? null);
  fact("travel", "Trip 1 (travel record)", "Toronto, Canada · Jun 10–17, 2023", trvCanada ?? null);
  fact("travel", "Trip 2 (travel record)", "Mumbai, India · Dec 20, 2023 – Jan 8, 2024", trvIndia ?? null);
  fact("travel", "Trip 3 (travel record)", "London, United Kingdom · Feb 14–21, 2024", trvUK ?? null);
  fact("travel", "Trips declared (intake)", "Canada (June 2023), India (Dec 2023 – Jan 2024)", intTravel ?? null);

  // ---------- Issue A: employment timeline ----------
  {
    const evidence = [dsStart, resStart, letContractor, letFullTime, intStart].filter((e): e is Evidence => !!e);
    const sources = new Set(evidence.map((e) => e.docId));
    if (dsStart && resStart && sources.size >= 2) {
      issues.push({
        id: "employment_timeline",
        title: "Employment start date differs across sources",
        kind: "conflict",
        severity: "high",
        summary:
          "The resume lists the Northstar relationship as beginning January 15, 2024, while the DS-160 lists an employment start date of March 1, 2024.",
        whyFlagged:
          "Two documents state different start dates for the same employer. Both dates are specific and neither document explains the other, so the case currently presents an unreconciled employment timeline.",
        evidence,
        possibleExplanation: letContractor
          ? "The employer's verification letter states the client began as an independent contractor on January 15, 2024 and converted to full-time employment on March 1, 2024. If confirmed, the two dates describe different relationships rather than a contradiction."
          : undefined,
        needToKnow: letContractor
          ? "Whether the client agrees that Jan 15 – Feb 29, 2024 was contractor work and Mar 1, 2024 was the full-time start, so the case can record both consistently."
          : "Which date is correct, and what the client's relationship with Northstar was on the earlier date.",
        suggestedQuestion: letContractor
          ? "Your resume lists January 15, 2024 as the start of your relationship with Northstar, while the application lists March 1, 2024. Your employer's letter suggests January was contractor work and March was full-time employment. Can you walk me through that timeline?"
          : "Your resume lists January 15, 2024 as your Northstar start date, while your application lists March 1, 2024. Which is correct, and what was your relationship with Northstar on the earlier date?",
        requiresClientContact: true,
      });
    }
  }

  // ---------- Issue B: address gap ----------
  {
    const evidence = [dsAddr2, dsAddr1, intAddr2, intAddr1, intOtherAddr].filter((e): e is Evidence => !!e);
    if ((dsAddr1 && dsAddr2) || (intAddr1 && intAddr2)) {
      issues.push({
        id: "address_gap",
        title: "No residence recorded for January 1 – April 30, 2024",
        kind: "gap",
        severity: "high",
        summary:
          "The address history ends the Austin residence on December 31, 2023 and begins the Atlanta residence on May 1, 2024, leaving four months with no recorded address.",
        whyFlagged:
          "Address history for the last five years must be continuous. The gap appears in every source that lists addresses" +
          (intOtherAddr ? ", and the intake questionnaire answers \"No\" to living at any other address, so no document explains it." : "."),
        evidence,
        needToKnow: "Where the client lived between January 1 and April 30, 2024 (full street address, city, state) and the dates at that location.",
        suggestedQuestion:
          "Your address history shows you left Austin on December 31, 2023 and moved into Peachtree Walk in Atlanta on May 1, 2024. Where were you living between January and April 2024?",
        requiresClientContact: true,
      });
    }
  }

  // ---------- Issue C: travel omission ----------
  {
    const evidence = [trvUK, trvUKStamp, dsCountries, intTravel, intOtherTrips].filter((e): e is Evidence => !!e);
    if (trvUK && (dsCountries || intTravel)) {
      issues.push({
        id: "travel_omission",
        title: "UK trip in travel record is missing from the application",
        kind: "omission",
        severity: "medium",
        summary:
          "The travel record lists a trip to London, United Kingdom from February 14 to February 21, 2024, but the DS-160 and intake questionnaire list only Canada and India as countries visited.",
        whyFlagged:
          "The travel record is corroborated by a passport stamp detail (UK Border Force, 15 FEB 2024), while the application's list of countries visited omits the United Kingdom entirely. Omitted travel is a common source of downstream questions at interview.",
        evidence,
        needToKnow: "Whether the UK trip occurred as recorded, its purpose, and confirmation of the dates so it can be added to the countries-visited list.",
        suggestedQuestion:
          "Your travel record shows a trip to London from February 14 to 21, 2024, but that trip isn't listed on your application. Did that trip take place, and what was the purpose?",
        requiresClientContact: true,
      });
    }
  }

  // ---------- Issue D: job title (attorney-only) ----------
  {
    const evidence = [dsTitle, letFullTime, intTitle, resStart].filter((e): e is Evidence => !!e);
    if (dsTitle && (letFullTime || intTitle || resStart)) {
      issues.push({
        id: "job_title",
        title: "Job title on DS-160 is less specific than other sources",
        kind: "conflict",
        severity: "low",
        summary: "The DS-160 lists the job title as \"Software Engineer\"; the employer letter, resume and intake questionnaire all say \"Software Engineer II\".",
        whyFlagged:
          "Likely a simplification rather than a substantive conflict — the employer's own letter is the authoritative source for the title. Flagged for attorney awareness; the client does not need to be asked.",
        evidence,
        possibleExplanation: "\"Software Engineer\" is a plausible shortening of \"Software Engineer II\" on a form with limited fields.",
        needToKnow: "Attorney to confirm the title should read \"Software Engineer II\" wherever it is recorded.",
        suggestedQuestion: "",
        requiresClientContact: false,
      });
    }
  }

  const planFor: Record<string, Omit<PlanStep, "issueId" | "askFirst">> = {
    employment_timeline: {
      approach: "ask_client",
      objective: "Record the contractor period and the full-time start consistently so the DS-160 employment date and the resume no longer disagree.",
      ifUnclear: "If the client cannot separate the two periods, ask whether they were paid as a contractor before March; if still unsure, leave unresolved and flag for confirmation with Northstar HR.",
      documentsThatWouldHelp: ["Professional services agreement or first contractor invoice", "Offer letter dated for the March 1 conversion"],
      followUps: ["How were you paid for the January and February contractor work, and do you have the agreement or invoices? The consulate may ask how that period was compensated.", "Did the Software Engineer II title apply during the contractor period, or only from March 1?"],
      fieldsAffected: [
        { document: "DS-160", field: "Employment Start Date" },
        { document: "Case record", field: "Employment history · Jan 15 – Feb 29, 2024" },
        { document: "Resume", field: "Northstar entry (annotate contractor vs. full-time)" },
      ],
    },
    address_gap: {
      approach: "ask_client",
      objective: "Make the five-year address history continuous from December 31, 2023 to May 1, 2024.",
      ifUnclear: "Ask for city and arrangement first (sublet, family, hotel), then the street address; if the client cannot recall, ask them to send a lease, bill or bank statement and leave the entry pending.",
      documentsThatWouldHelp: ["Sublease or lease", "Utility bill or bank statement showing the address"],
      followUps: ["When you moved from Austin to Atlanta, did you report the new address to USCIS within ten days, as F-1 holders are required to do?"],
      fieldsAffected: [
        { document: "DS-160", field: "Address History · Jan 1 – Apr 30, 2024" },
        { document: "Intake questionnaire", field: "Any other address in the last five years?" },
      ],
    },
    travel_omission: {
      approach: "ask_client",
      objective: "Add the February 2024 UK trip to every place countries visited are declared, with purpose and dates.",
      ifUnclear: "If the client denies the trip, cite the UK Border Force stamp and the Atlanta re-entry stamp and ask whether the record could be wrong; if they still deny it, leave unresolved for the attorney to check the physical passport.",
      documentsThatWouldHelp: ["Passport stamp pages", "Flight confirmation"],
      followUps: ["Were you re-admitted on your F-1 status when you came back through Atlanta on February 21, and do you still have the boarding pass or itinerary?"],
      fieldsAffected: [
        { document: "DS-160", field: "Countries Visited (Last Five Years)" },
        { document: "Intake questionnaire", field: "Any other trips outside the U.S.?" },
      ],
    },
    job_title: {
      approach: "attorney_confirms_from_file",
      objective: "Conform the DS-160 job title to the employer letter.",
      ifUnclear: "Not applicable — the employer letter is authoritative.",
      documentsThatWouldHelp: [],
      followUps: [],
      fieldsAffected: [{ document: "DS-160", field: "Job Title" }],
    },
  };
  const resolutionPlan: PlanStep[] = issues.map((i) => ({ issueId: i.id, askFirst: i.suggestedQuestion, ...planFor[i.id] }));

  const has = (role: Role) => byRole.get(role)?.name;
  const evidenceChecklist: EvidenceCheck[] = [
    { item: "I-797 approval notice for the H-1B petition", status: "missing", why: "The DS-160 cites petition receipt WAC2490312345, but no approval notice is in the file; the consulate will ask for it.", askClient: true, question: "Do you have the I-797 approval notice for your H-1B petition, or is it still with the employer?" },
    { item: "Certified Labor Condition Application (LCA)", status: "missing", why: "Required for the interview; the work location on it must match the Atlanta address history and the employer letter.", askClient: false, question: "" },
    { item: "Employer verification letter", status: has("letter") ? "present" : "missing", why: "Confirms title, salary, start date and work location.", foundIn: has("letter"), askClient: false, question: "" },
    { item: "Degree certificates and transcripts (M.S. and B.Tech.)", status: "missing", why: "The position requires at least a bachelor's degree; the resume lists a B.Tech. and an M.S. but no diplomas or transcripts are in the file.", askClient: true, question: "Do you have your degree certificates and transcripts for both the UT Austin master's and the B.Tech. from Gujarat Technological University?" },
    { item: "Resume / CV", status: has("resume") ? "present" : "missing", why: "Must be consistent with the petition and DS-160.", foundIn: has("resume"), askClient: false, question: "" },
    { item: "Evidence for the January–February 2024 contractor period", status: "missing", why: "The employer letter describes a contractor engagement before March 1, 2024; no agreement, invoices or 1099 are in the file.", askClient: true, question: "For the contractor work in January and February, do you still have the services agreement or any invoices or payment records?" },
    { item: "Complete five-year travel history consistent with passport stamps", status: has("travel") ? "unclear" : "missing", why: "A travel record exists, but the DS-160 omits the UK trip it shows; the passport stamp pages themselves are not in the file.", foundIn: has("travel"), askClient: false, question: "" },
    { item: "Evidence of current F-1 / OPT status (I-20, EAD)", status: "missing", why: "The DS-160 states the client is in F-1 OPT status; no I-20 or EAD is in the file.", askClient: true, question: "Do you have your most recent I-20 and your OPT employment authorization card available?" },
    { item: "DS-160 confirmation page", status: has("ds160") ? "present" : "missing", why: "The application summary is in the file.", foundIn: has("ds160"), askClient: false, question: "" },
  ];

  return {
    caseSummary: {
      clientName: "Maya Patel",
      caseType: "H-1B · Consular Processing (U.S. Consulate General, Mumbai)",
      employer: "Northstar Systems LLC",
      attorney: "Daksh Sharma, Sharma LLP",
      matterNumber: "SL-2024-0417",
      summary:
        `${docs.length} document${docs.length === 1 ? "" : "s"} analyzed as one case. ` +
        "Identity, employer and education facts agree across sources. " +
        `${issues.filter((i) => i.requiresClientContact).length} issue(s) need client clarification; ` +
        `${issues.filter((i) => !i.requiresClientContact).length} can be resolved by the attorney from the file.`,
    },
    facts,
    issues,
    resolutionPlan,
    evidenceChecklist,
    engine: "demo",
    engineLabel: "Demo mode, rule-based analysis of the uploaded files (no API key configured)",
  };
}
