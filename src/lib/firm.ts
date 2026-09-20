// The attorney string extracted from the case file ("Daksh Sharma, Sharma LLP"), split for speech.

export interface AttorneyParts {
  /** The named individual, if the file names one. */
  person: string | null;
  /** The firm, or a neutral fallback. */
  firm: string;
  /** How the agent introduces who it is calling for: "Daksh Sharma at Sharma LLP". */
  onBehalfOf: string;
}

export function attorneyParts(attorney: string | undefined): AttorneyParts {
  const raw = (attorney ?? "").trim();
  if (!raw || /^not stated$/i.test(raw)) return { person: null, firm: "your attorney's office", onBehalfOf: "your attorney's office" };
  // "Daksh Sharma, Esq., Sharma LLP" — drop honorifics so the firm is the firm.
  const [head, ...rest] = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^(esq\.?|esquire|attorney(?: at law)?|j\.?d\.?|llm|counsel)$/i.test(s));
  if (rest.length === 0) return { person: null, firm: head, onBehalfOf: head };
  const firm = rest.join(", ");
  return { person: head, firm, onBehalfOf: `${head} at ${firm}` };
}
