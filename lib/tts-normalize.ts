/** Bump this whenever normalizeTtsText rules change to invalidate cached audio. */
export const TTS_NORM_VERSION = "ttsNorm:1";

/**
 * Expand abbreviations that TTS engines commonly mispronounce.
 * Context-dependent abbreviations (St., Dr.) use position heuristics:
 *   - Before a capitalized word → proper-noun reading (Saint, Doctor)
 *   - After another word / end of phrase → address reading (Street, Drive)
 */
export const normalizeTtsText = (text: string): string => {
  let r = text;

  // ── Context-dependent ──────────────────────────────────────────────
  // "St." before a capitalized word → Saint  (St. Louis, St. Patrick)
  r = r.replace(/\bSt\.\s+(?=[A-Z])/g, "Saint ");
  // remaining "St." after a word → Street  (Main St., Baker St.)
  r = r.replace(/(\w)\s+St\.(?=[\s,;.!?]|$)/gm, "$1 Street");

  // "Dr." before a capitalized word → Doctor  (Dr. King)
  r = r.replace(/\bDr\.\s+(?=[A-Z])/g, "Doctor ");
  // remaining "Dr." after a word → Drive  (Sunset Dr.)
  r = r.replace(/(\w)\s+Dr\.(?=[\s,;.!?]|$)/gm, "$1 Drive");

  // "Mt." → Mount  (Mt. Everest, Mt. Rushmore)
  r = r.replace(/\bMt\.\s*/g, "Mount ");

  // "Ft." before a capitalized word → Fort  (Ft. Lauderdale)
  r = r.replace(/\bFt\.\s+(?=[A-Z])/g, "Fort ");

  // ── Unambiguous abbreviations ──────────────────────────────────────
  const SIMPLE: [RegExp, string][] = [
    [/\bAve\.(?=[\s,;]|$)/gm, "Avenue"],
    [/\bBlvd\.(?=[\s,;]|$)/gm, "Boulevard"],
    [/\bDept\.(?=[\s,;]|$)/gm, "Department"],
    [/\bJr\.(?=[\s,;]|$)/gm, "Junior"],
    [/\bSr\.(?=[\s,;]|$)/gm, "Senior"],
    [/\bCorp\.(?=[\s,;]|$)/gm, "Corporation"],
    [/\bInc\.(?=[\s,;]|$)/gm, "Incorporated"],
    [/\bLtd\.(?=[\s,;]|$)/gm, "Limited"],
    [/\bvs\.(?=[\s,;]|$)/gm, "versus"],
    [/\bVol\.(?=[\s,;]|$)/gm, "Volume"],
    [/\bca\.\s+(?=\d)/g, "circa "],
    [/\bNo\.\s*(?=\d)/g, "Number "],
    [/\bPt\.\s*(?=\d)/g, "Part "],

    // Titles before a proper name
    [/\bGen\.\s+(?=[A-Z])/g, "General "],
    [/\bGov\.\s+(?=[A-Z])/g, "Governor "],
    [/\bSgt\.\s+(?=[A-Z])/g, "Sergeant "],
    [/\bCapt\.\s+(?=[A-Z])/g, "Captain "],
    [/\bCol\.\s+(?=[A-Z])/g, "Colonel "],
    [/\bLt\.\s+(?=[A-Z])/g, "Lieutenant "],
    [/\bProf\.\s+(?=[A-Z])/g, "Professor "],
    [/\bSen\.\s+(?=[A-Z])/g, "Senator "],
    [/\bRep\.\s+(?=[A-Z])/g, "Representative "],
  ];

  for (const [pattern, replacement] of SIMPLE) {
    r = r.replace(pattern, replacement);
  }

  return r;
};
