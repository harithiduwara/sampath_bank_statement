import { levenshtein } from "./ocrText";

/**
 * Sampath narrations start with the originating branch, truncated to eight
 * characters ("KIRULAPO", "MAHARAGA", "KANDY SU"). OCR'd variants of these
 * are snapped back to the real name.
 */
const BRANCHES = [
  "CITY", "H/O", "NSC", "Kirulapone", "Maharagama", "Kandy Super", "Kandy", "Aluthgama", "Nugegoda", "Panchikawatte",
  "Karagampitiya", "Nawala", "Narahenpita", "Peliyagoda", "Pettah", "Borella", "Kollupitiya", "Bambalapitiya",
  "Wellawatte", "Dehiwala", "Mount Lavinia", "Ratmalana", "Moratuwa", "Panadura", "Kalutara", "Horana", "Wadduwa",
  "Beruwala", "Matugama", "Bandaragama", "Piliyandala", "Kottawa", "Homagama", "Pannipitiya", "Kohuwala",
  "Battaramulla", "Rajagiriya", "Malabe", "Kaduwela", "Athurugiriya", "Thalawathugoda", "Kotahena", "Grandpass",
  "Wattala", "Kelaniya", "Kiribathgoda", "Kadawatha", "Ragama", "Ja-Ela", "Kandana", "Negombo", "Katunayake",
  "Minuwangoda", "Gampaha", "Nittambuwa", "Veyangoda", "Mirigama", "Divulapitiya", "Wennappuwa", "Marawila",
  "Chilaw", "Puttalam", "Kuliyapitiya", "Kurunegala", "Narammala", "Pannala", "Wariyapola", "Dambulla", "Matale",
  "Kegalle", "Mawanella", "Warakapola", "Avissawella", "Ratnapura", "Embilipitiya", "Balangoda", "Pelmadulla",
  "Gampola", "Nawalapitiya", "Peradeniya", "Katugastota", "Kundasale", "Digana", "Wattegama", "Pilimathalawa",
  "Kadugannawa", "Nuwara Eliya", "Hatton", "Badulla", "Bandarawela", "Welimada", "Monaragala", "Galle",
  "Ambalangoda", "Hikkaduwa", "Elpitiya", "Karapitiya", "Matara", "Weligama", "Akuressa", "Deniyaya", "Tangalle",
  "Hambantota", "Tissamaharama", "Anuradhapura", "Polonnaruwa", "Kekirawa", "Trincomalee", "Batticaloa",
  "Kalmunai", "Ampara", "Jaffna", "Chunnakam", "Vavuniya", "Mannar", "Kilinochchi", "Hingurakgoda", "Thambuttegama",
  "Eheliyagoda", "Ingiriya", "Padukka", "Hanwella", "Kirindiwela", "Delgoda", "Ganemulla", "Ekala", "Seeduwa",
  "Moratumulla", "Boralesgamuwa", "Maharagama Super", "Havelock Town", "Thimbirigasyaya", "Union Place",
  "World Trade Center", "Kotte", "Kalubowila", "Attidiya", "Mirihana", "Gangodawila", "Wijerama",
].map((b) => b.toUpperCase().slice(0, 8));

/** Narration codes; e.g. "YSRTFR" / "VSRIFR" -> "VSRTFR", "CHO" -> "CHQ". */
const CODES = ["VSRTFR", "CACHQ", "TrCHQ", "CHQ", "CASH", "S/CHG", "CHQBKCHG", "CEFTFR", "RTGS", "SLIPS", "DEPOSIT", "INITIAL"];

// digits OCR commonly substitutes for letters in all-caps branch names
const LETTERISH: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "6": "G", "2": "Z" };
const squash = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9/]/g, "")
    .replace(/[0-9]/g, (d) => LETTERISH[d] ?? d);

function snapBranch(tokens: string[]): string[] {
  let best: { name: string; take: number; dist: number } | null = null;
  let runnerUp = Infinity;
  for (let take = 1; take <= Math.min(2, tokens.length); take++) {
    const head = squash(tokens.slice(0, take).join(""));
    if (head.length < 3) continue;
    for (const name of BRANCHES) {
      const target = squash(name);
      const dist = levenshtein(head, target);
      const allowed = target.length <= 6 ? 1 : target.length < 8 ? 2 : 3;
      if (dist > allowed) continue;
      if (!best || dist < best.dist || (dist === best.dist && take > best.take)) {
        if (best && best.name !== name) runnerUp = Math.min(runnerUp, best.dist);
        best = { name, take, dist };
      } else if (name !== best.name) {
        runnerUp = Math.min(runnerUp, dist);
      }
    }
  }
  // a loose (3-edit) match is only trusted when no other branch comes close
  if (!best || (best.dist >= 3 && runnerUp <= best.dist + 1)) return tokens;
  return [best.name, ...tokens.slice(best.take)];
}

function snapCode(word: string): string {
  const [head, ...rest] = word.split("-");
  if (head.length < 3) return word;
  const maxDist = head.length <= 4 ? 1 : 2;
  let best: string | null = null, bestDist = Infinity;
  for (const code of CODES) {
    if (Math.abs(code.length - head.length) > maxDist) continue;
    const d = levenshtein(head.toUpperCase(), code.toUpperCase());
    if (d < bestDist) [best, bestDist] = [code, d];
  }
  const fixed = best && bestDist <= maxDist && bestDist < head.length / 2 ? best : head;
  return [fixed, ...rest].join("-");
}

/** Cleans an OCR'd Sampath narration: branch name first, then known codes. */
export function cleanNarration(tokens: string[]): string {
  return snapBranch(tokens).map((t, i) => (i === 0 ? t : snapCode(t))).join(" ");
}
