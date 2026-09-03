/**
 * Geometry → lines → blocks → transaction rows — the model-free reference
 * algorithm behind "scan a bank statement screenshot and get one draft per
 * row" (docs/design/statement-scan-spec.md §4.2, transcribed from the
 * 2026-09-02 Mac probe's `rows2.mjs`).
 *
 * Pure and framework-free: every threshold is relative to `medH` (the median
 * observation height) so the same result comes out whether the screenshot is
 * zoomed, cropped-but-complete, or scaled — see spec acceptance criterion 5.
 * No model, no network — see `docs/design/statement-scan-spec.md` §2.3 for why
 * that's the whole point (criterion 17's source-grep locks this down).
 */
import { OcrObservation } from './ocrObservation';

export interface LayoutRow {
  /** Text of the nearest date-only line above this row, or null. */
  dateText: string | null;
  /** Major units as printed, e.g. 1198.3. */
  value: number;
  sign: '-' | '+' | '?';
  /** All non-amount text in the block, x-sorted within each line, lines
   *  joined by ' '. Uncleaned — see statementDrafts.ts's cleanDescription. */
  description: string;
  /** The amount token as printed ("SGD - 1.50", "-16.74") — for the honesty
   *  check (criterion 4): always the text of exactly one observation. */
  amountText: string;
  /** ISO 4217 code parsed from the amount token's own currency symbol/code
   *  ("USD 12.99" → "USD", "S$ 8.30" → "SGD"), or null when the token
   *  printed no currency at all, or only a bare "$" (ambiguous — never
   *  treated as a claim; reviewer B3). Statement-scan's own honesty
   *  signal for a foreign-currency row — see statementDrafts.ts's
   *  `mismatchedCurrency`. */
  currency: string | null;
}

export interface StatementLayout {
  kind: 'statement' | 'single' | 'receipt' | 'unknown';
  rows: LayoutRow[];
  /** Text of kept lines above the first row (bank / account header), for
   *  account matching (findAccountMatch). */
  headerText: string;
  /** The TOTAL / Grand total / Amount due amount, when kind === 'receipt'. */
  receiptTotal: { value: number; text: string } | null;
  /** Count of amount-bearing LINES inside dropped multi-amount blocks — a
   *  dual-currency line ("USD 12.00 SGD 16.20") is 1, three separate
   *  single-amount lines merged into one uniformly-spaced block (no gap
   *  jump to split on) are 3. Feeds the screen's end-of-queue summary
   *  ("N rows couldn't be read", alongside `rowsToDrafts`' own `dropped`
   *  count of zero-value rows) — see app/(tabs)/index.tsx. */
  unreadRows: number;
  /** All observation text joined with '\n' in Vision order — what the
   *  existing single-receipt flow expects (classifyOcrText/runParse). */
  text: string;
}

/** `[A-Z]{3}` (SGD, USD, …) or a handful of common bare currency symbols.
 *  Capturing (reviewer B3) — the token's own currency is read back out via
 *  `currencyFromMatch` below, so `rowsToDrafts` can flag a foreign-currency
 *  row instead of silently storing it as the account's own currency. */
const CUR = '([A-Z]{3}|S\\$|US\\$|\\$|€|£)';

/** A part is an amount only when it fully matches this — two decimal places
 *  are mandatory, which is what keeps a card suffix ("-4008"), a reference
 *  ("PLPE4624509251917590"), an order number ("M972") and a quantity ("2")
 *  out. See spec §4.2 step 2. Group numbering: 1/3 = the (optional) currency
 *  token on either side of the sign, 2 = sign, 4 = digits, 5 = CR|DR. */
const AMOUNT_RE = new RegExp(
  `^${CUR}?\\s*([-+])?\\s*${CUR}?\\s*(\\d{1,3}(?:,\\d{3})*\\.\\d{2}|\\d+\\.\\d{2})\\s*(CR|DR)?$`,
  'i'
);

/** ISO 4217 code for whichever currency token AMOUNT_RE matched (group 1 or
 *  3), or null when the token printed no currency, or only a bare "$" —
 *  shared by SGD/USD/AUD/CAD/HKD/NZD and so ambiguous on its own (same
 *  reasoning as deviceParsePrompt.ts's currency-grounding guard: a bare
 *  symbol is never treated as a deliberate currency claim). */
function currencyFromMatch(match: RegExpExecArray): string | null {
  const raw = match[1] ?? match[3];
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  if (upper === 'S$') return 'SGD';
  if (upper === 'US$') return 'USD';
  if (raw === '€') return 'EUR';
  if (raw === '£') return 'GBP';
  return null; // bare "$" — ambiguous, not a claim.
}

/** A month name (abbreviated or spelled out — the trailing `[a-z]*` covers
 *  "Aug"/"August", "Sep"/"Sept"/"September", …), required by the two
 *  number+word DATE_LINE_RES patterns below (reviewer MINOR 2) — without
 *  this, `^\d{1,2}\s+[A-Za-z]{3,9}$` / `^[A-Za-z]{3,9},?\s+\d{1,2}$` also
 *  matched "2 Pending", "Order 12", "Table 5", turning ordinary UI/receipt
 *  text into a phantom date line that silently defaulted every following
 *  row's date. */
const MONTH_RE = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

/** A date-only line: "Today"/"Yesterday" (with anything after, e.g. a
 *  printed date), "25 Aug[ 2026]", "Aug 25[, 2026]", or a numeric date. */
const DATE_LINE_RES: RegExp[] = [
  /^(today|yesterday)\b/i,
  new RegExp(`^\\d{1,2}\\s+${MONTH_RE}(\\s+\\d{4})?$`, 'i'),
  new RegExp(`^${MONTH_RE},?\\s+\\d{1,2}(\\s+\\d{4})?$`, 'i'),
  /^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$/,
];

/** An optional leading weekday ("Wednesday, ", "Wed ") stripped before the
 *  date-line length/pattern checks below (MINOR 4, QA) — "Wednesday, 25
 *  August 2026" is otherwise ordinary text: it's 26 characters (over the
 *  24-char date-line cap) and no DATE_LINE_RES pattern expects a leading
 *  weekday word. The line's own `.text` (and so `LayoutRow.dateText`) keeps
 *  the weekday; only the classification check strips it — `resolveAbsoluteDate`
 *  (statementDrafts.ts) already parses straight through a leading weekday on
 *  its own (verified with `npx tsx`), so nothing downstream needs to know
 *  the prefix was ever there. */
const WEEKDAY_PREFIX_RE = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/i;

/** Maps the classic OCR digit-for-letter confusions back to letters
 *  ("T0TAL" → "total", "G5T in" → "gst in") before every LABEL-shaped
 *  regex test below (review B2 follow-up) — Vision's `.accurate` mode still
 *  occasionally reads a stylised 'O'/'S'/'I' as a digit on a low-contrast
 *  total line. Deliberately narrow: `0→o`, `5→s`, `1→l`, `|→l` only, and
 *  ONLY ever applied to text already being tested against a label regex
 *  (`TOTAL_FAMILY_RE`, `BALANCE_VOCAB_RE`, `signalKindOf`'s
 *  GRAND_TOTAL_RE/TOTAL_RE/AMOUNT_DUE_RE/SUBTOTAL_RE/TAX_FAMILY_RE) — never
 *  to amount parsing, date detection, descriptions, `headerText`, or
 *  `text`.
 *
 *  NOT safe in general: a merchant description CAN collide with one of
 *  these dictionary words after normalisation ("G5T Enterprises" → "gst
 *  enterprises" reads exactly like a GST line) — QA MAJOR 1. The real
 *  safety property is narrower: matching this alone (a "soft" match, see
 *  `hardTotalLines`/`softTotalLines` below) never removes a row on its
 *  own — the block is treated exactly as it would be had normalisation
 *  never run unless the receipt-kind GATE actually fires, so a NON-receipt
 *  layout stays byte-identical to the pre-normalisation behaviour.
 *
 *  Narrower still (blocker found by fuzzing, 30k layouts): TWO soft
 *  matches must not be allowed to gate a receipt on their own either — two
 *  ordinary merchant lines that each merely look like a total-family label
 *  ("G5T Enterprises", "T0TAL Sports") could otherwise combine to >= 2
 *  "distinct families" and collapse a real dated, interleaved statement
 *  into a fabricated one-row receipt. A soft match can only tip the gate
 *  when the picture is already receipt-SHAPED — undated, and every signal
 *  sits below the last HARD row; on a dated or interleaved layout, soft
 *  evidence is inert (see `footerShaped` below). */
function normaliseLabel(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[015|]/g, (c) => ({ '0': 'o', '1': 'l', '5': 's', '|': 'l' })[c]!);
}

/** A total-family-SHAPED line — matches a running BALANCE header too
 *  ("Total balance 12,480.55"), which is why matching this alone is never
 *  enough to call something a receipt signal (reviewer B2, see
 *  `BALANCE_VOCAB_RE`/`signalKindOf` below). A block containing one of
 *  these is still never a row either way — a balance/total line becoming
 *  its own drafted "expense" would be exactly as wrong as the amount it
 *  prints being mistaken for a receipt total. */
const TOTAL_FAMILY_RE =
  /^(total|sub ?-?total|subtot|grand total|amount due|gst|tax|service charge)\b/i;
const GRAND_TOTAL_RE = /^grand total\b/i;
const TOTAL_RE = /^total\b/i;
const AMOUNT_DUE_RE = /^amount due\b/i;
const SUBTOTAL_RE = /^(sub ?-?total|subtot)\b/i;
const TAX_FAMILY_RE = /^(gst|tax|service charge)\b/i;

/** Running-balance vocabulary (reviewer B2) — a total-family-shaped line
 *  whose own text contains one of these is a bank statement HEADER
 *  ("Total balance 12,480.55", "Available credit 500.00"), not a receipt
 *  signal; never contributes to `receiptTotal` or to the receipt-kind gate
 *  below, even though the block still isn't a row. */
const BALANCE_VOCAB_RE =
  /\b(balance|available|assets|credit|limit|outstanding|spent|spending|payable|owed|savings|net worth)\b/i;

/** Which of the three receipt-signal FAMILIES a total-family line belongs
 *  to, or null when it's balance-tainted / unrecognised. Distinct from the
 *  finer-grained GRAND_TOTAL_RE/TOTAL_RE/AMOUNT_DUE_RE priority used for
 *  picking the actual `receiptTotal` VALUE — this is only for counting how
 *  many distinct signal KINDS appear (the receipt-kind gate, reviewer B2). */
type SignalKind = 'subtotal' | 'tax' | 'total';
function signalKindOf(label: string): SignalKind | null {
  if (SUBTOTAL_RE.test(label)) return 'subtotal';
  if (TAX_FAMILY_RE.test(label)) return 'tax';
  if (GRAND_TOTAL_RE.test(label) || TOTAL_RE.test(label) || AMOUNT_DUE_RE.test(label)) return 'total';
  return null;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The bare numeric magnitude printed in an amount token ("SGD - 1,198.30"
 *  → 1198.3). Commas stripped; sign/currency/CR/DR ignored — sign is read
 *  separately (see `signFromMatch`). */
function parseAmountValue(amountText: string): number {
  const m = /(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/.exec(amountText);
  if (!m) return 0;
  return parseFloat(m[1]!.replace(/,/g, ''));
}

/** Sign from AMOUNT_RE's OWN capture groups — group 2 is `[-+]`, group 5 is
 *  `CR|DR` — rather than re-scanning the whole matched string (reviewer
 *  MINOR 1): a currency CODE can itself contain "DR"/"CR" as a substring
 *  ("IDR 150.00", "CRC 150.00"), which the old whole-string scan
 *  misread as a debit/credit marker. `-`/DR checked first: a print that
 *  somehow carries both a debit and a credit marker (never seen in
 *  practice) resolves to expense, the safer default (statementDrafts.ts
 *  treats '?' the same as '-' anyway).
 */
function signFromMatch(match: RegExpExecArray): '-' | '+' | '?' {
  const signGroup = match[2];
  const crDr = match[5]?.toUpperCase();
  if (signGroup === '-' || crDr === 'DR') return '-';
  if (signGroup === '+' || crDr === 'CR') return '+';
  return '?';
}

interface RawLine {
  items: (OcrObservation & { cy: number })[];
  cy: number;
  top: number;
  bottom: number;
}

interface AmountPart {
  trimmed: string;
  value: number;
  sign: '-' | '+' | '?';
  currency: string | null;
}

interface ProcessedLine {
  top: number;
  bottom: number;
  amountParts: AmountPart[];
  /** Non-amount text, x-sorted, space-joined. */
  text: string;
  kind: 'date' | 'noise' | 'text';
}

/** Step 1: sort by centre-y and merge into lines within 0.6×medH. */
function buildLines(observations: OcrObservation[], medH: number): RawLine[] {
  const withCy = observations
    .map((o) => ({ ...o, cy: o.y + o.h / 2 }))
    .sort((a, b) => a.cy - b.cy);

  const lines: RawLine[] = [];
  for (const o of withCy) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current.cy - o.cy) < 0.6 * medH) {
      current.items.push(o);
      current.cy = current.items.reduce((sum, it) => sum + it.cy, 0) / current.items.length;
      current.top = Math.min(current.top, o.y);
      current.bottom = Math.max(current.bottom, o.y + o.h);
    } else {
      lines.push({ items: [o], cy: o.cy, top: o.y, bottom: o.y + o.h });
    }
  }
  return lines;
}

/** Steps 2-4: split each line into amount/text parts, then classify. */
function processLines(lines: RawLine[]): ProcessedLine[] {
  return lines.map((line) => {
    const sortedItems = [...line.items].sort((a, b) => a.x - b.x);
    const amountParts: AmountPart[] = [];
    const textParts: string[] = [];
    for (const item of sortedItems) {
      const trimmed = item.text.trim();
      const match = AMOUNT_RE.exec(trimmed);
      if (match) {
        amountParts.push({
          trimmed,
          value: parseAmountValue(trimmed),
          sign: signFromMatch(match),
          currency: currencyFromMatch(match),
        });
      } else if (trimmed) {
        textParts.push(trimmed);
      }
    }
    const text = textParts.join(' ').trim();
    let kind: ProcessedLine['kind'] = 'text';
    if (amountParts.length === 0) {
      const forDateCheck = text.replace(WEEKDAY_PREFIX_RE, '');
      const isDate = forDateCheck.length <= 24 && DATE_LINE_RES.some((re) => re.test(forDateCheck));
      if (isDate) kind = 'date';
      else if (!/[a-z0-9]/i.test(text)) kind = 'noise';
    }
    return { top: line.top, bottom: line.bottom, amountParts, text, kind };
  });
}

/**
 * Step 5: the split threshold is the midpoint of the largest relative jump
 * among gaps > 0.5×medH.
 *
 * When NO jump qualifies, this used to fall back to `medH` itself — but with
 * a genuinely uniform gap (e.g. OCBC's own description-above/amount-below
 * spacing repeated with no jump anywhere, QA's re-gate regate2.ts), every
 * gap sits at ~medH, and floating-point noise in the geometry (a real
 * screenshot's boxes are never exact multiples of medH) then makes SOME of
 * those gaps compare as `> medH` and others as `<= medH` — a single block
 * splits inconsistently into partial pieces instead of staying one block or
 * becoming N clean rows, silently pairing an amount from one line with a
 * description from another (the one outcome this feature must never
 * produce).
 *
 * Returning `Infinity` instead means: no jump signal → NO gap-based split at
 * all. Whatever would have been one block by the jump rule stays one block.
 * `splitSelfContainedBlocks` (below) still turns a uniform list of complete
 * one-line rows into N rows; everything else — an OCBC-style two-line row
 * repeated with no jump, an alternating amount-only/description-only list —
 * becomes one block with ≥2 amounts: an honest table (counted in the
 * dropped-rows summary — spec §7, QA M1), not a guessed pairing. Date lines
 * still start a new block on either side regardless (that split doesn't
 * depend on this threshold at all — see the caller).
 */
function blockSplitThreshold(gaps: number[], medH: number): number {
  // Reviewer B1: the floor used to apply to `gi` only, so a single
  // sub-pixel gap (two nearly-touching lines) could stand as `gPrev` — the
  // ratio then explodes, the threshold collapses to half the smallest REAL
  // gap, and an amount line ends up glued to the FOLLOWING row's
  // description instead of its own. Filtering BOTH sides of every pair to
  // real gaps (> 0.5×medH) before sorting/comparing means a noise gap can
  // never anchor a false "jump" in either direction.
  const sorted = gaps.filter((g) => g > 0.5 * medH).sort((a, b) => a - b);
  let bestRatio = 0;
  let bestPair: [number, number] | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const gi = sorted[i]!;
    const gPrev = sorted[i - 1]!;
    const ratio = gi / gPrev;
    if (ratio > 1.8 && ratio > bestRatio) {
      bestRatio = ratio;
      bestPair = [gPrev, gi];
    }
  }
  return bestPair ? (bestPair[0] + bestPair[1]) / 2 : Infinity;
}

function groupIntoBlocks(kept: ProcessedLine[], medH: number): ProcessedLine[][] {
  if (kept.length === 0) return [];
  const gaps = kept.slice(1).map((line, i) => Math.max(0, line.top - kept[i]!.bottom));
  const threshold = blockSplitThreshold(gaps, medH);

  const blocks: ProcessedLine[][] = [];
  let current: ProcessedLine[] = [kept[0]!];
  for (let i = 1; i < kept.length; i++) {
    const gap = gaps[i - 1]!;
    const prevIsDate = kept[i - 1]!.kind === 'date';
    const curIsDate = kept[i]!.kind === 'date';
    if (gap > threshold || prevIsDate || curIsDate) {
      blocks.push(current);
      current = [kept[i]!];
    } else {
      current.push(kept[i]!);
    }
  }
  blocks.push(current);
  return blocks;
}

/**
 * A gap-based block that the largest-relative-jump rule (blockSplitThreshold)
 * couldn't separate, because its lines are evenly spaced — no jump exists,
 * so the threshold is Infinity and no gap-based split happens at all. That
 * leaves several genuinely separate rows sitting in one block (QA MAJOR 2
 * repro: uniformly spaced single-line rows).
 *
 * A line is self-contained when it carries AT LEAST ONE amount part AND at
 * least one word of description, on the SAME line — a plain single-amount
 * row ("Coffee -4.50") and a dual-currency row ("Coffee USD 12.00 SGD
 * 16.20") are both self-contained; only an amount-ONLY line or a
 * description-ONLY line is not. When EVERY line in the block is
 * self-contained, splitting one line per row is the honest read, not a
 * guess: each line already carries everything a row needs on its own — the
 * per-line classification below then turns a one-amount line into a row and
 * a several-amount line into `unreadRows` (never a guessed merchant). A
 * block containing an amount-only line or a description-only line is left
 * alone (stays one merged block, dropped as `unreadRows`): bank1's
 * continuation lines sit BELOW the amount line (no amount on them) and
 * OCBC's description sits ABOVE the amount line (also no amount on that
 * line), so attaching either kind of line to a neighbour without a real gap
 * signal would be guessing which row it belongs to — a confidently-wrong
 * merchant is worse than an honest drop.
 */
function splitSelfContainedBlocks(blocks: ProcessedLine[][]): ProcessedLine[][] {
  const result: ProcessedLine[][] = [];
  for (const block of blocks) {
    const everyLineIsSelfContained =
      block.length >= 2 &&
      block.every((line) => line.amountParts.length >= 1 && line.text.trim() !== '');
    if (everyLineIsSelfContained) {
      for (const line of block) result.push([line]);
    } else {
      result.push(block);
    }
  }
  return result;
}

interface ReceiptTotalCandidate {
  value: number;
  text: string;
  priority: 1 | 2 | 3; // amount due < total < grand total
}

export function reconstructLayout(observations: OcrObservation[]): StatementLayout {
  const text = observations.map((o) => o.text).join('\n');
  if (observations.length === 0) {
    return { kind: 'unknown', rows: [], headerText: '', receiptTotal: null, unreadRows: 0, text };
  }

  const medH = median(observations.map((o) => o.h));
  const lines = processLines(buildLines(observations, medH));
  const kept = lines.filter((l) => l.kind !== 'noise');
  if (kept.length === 0) {
    return { kind: 'unknown', rows: [], headerText: '', receiptTotal: null, unreadRows: 0, text };
  }

  const blocks = splitSelfContainedBlocks(groupIntoBlocks(kept, medH));

  const rows: LayoutRow[] = [];
  const headerParts: string[] = [];
  let unreadRows = 0;
  let receiptTotal: ReceiptTotalCandidate | null = null;
  let lastDateText: string | null = null;
  let sawFirstRow = false;
  let dateLineSeen = false;
  let lastRowBlockIndex = -1;
  // Narrower than lastRowBlockIndex (review follow-up — two SOFT signals
  // must not be enough to collapse a statement on their own): only a HARD
  // row counts as "below the rows" evidence for the footer-shape check
  // below. A soft block that fell through and turned out to be a row does
  // NOT advance this.
  let lastHardRowBlockIndex = -1;
  // Every NON-balance-tainted total-family line, for the receipt-kind gate
  // below (reviewer B2) — collected here, decided after the loop, since
  // "is this signal below the last row" needs to know where the LAST row
  // ended up, which isn't known until every block has been visited. `soft`
  // (QA MAJOR 1) marks a signal that only matched after `normaliseLabel`
  // (never matched HEAD's exact-text TOTAL_FAMILY_RE) — see hardTotalLines/
  // softTotalLines below.
  const signals: { blockIndex: number; kind: SignalKind; soft: boolean }[] = [];

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]!;
    // A lone date line sets dateText for following rows and is never a row
    // itself.
    if (block.length === 1 && block[0]!.kind === 'date') {
      lastDateText = block[0]!.text;
      dateLineSeen = true;
      if (!sawFirstRow) headerParts.push(block[0]!.text);
      continue;
    }

    // Two-tier classification (QA MAJOR 1): `hardTotalLines` is HEAD's own
    // exact-text match — untouched by normalisation. Only when NO line in
    // the block matches on exact text do we fall back to the normalised
    // (`soft`) match, so a genuine total-family block behaves exactly as it
    // always has, and a merchant description that merely LOOKS like one
    // after digit-remapping ("G5T Enterprises" → "gst enterprises") is
    // never dropped outright — it can only become a receipt-signal line
    // when the receipt gate below actually fires on real (≥2-family)
    // evidence.
    const hardTotalLines = block.filter((l) => TOTAL_FAMILY_RE.test(l.text.trim()));
    const softTotalLines = hardTotalLines.length
      ? []
      : block.filter((l) => TOTAL_FAMILY_RE.test(normaliseLabel(l.text)));
    const totalLines = hardTotalLines.length ? hardTotalLines : softTotalLines;
    const soft = hardTotalLines.length === 0 && softTotalLines.length > 0;
    if (totalLines.length > 0) {
      // Rule (i): a HARD total-family-shaped block is NEVER a row,
      // independent of whether any of its lines end up counting as a
      // receipt SIGNAL below — a bank-statement "Total balance" header
      // must not become a drafted row any more than it should become a
      // receipt total. A SOFT block (only matched after normalisation)
      // stays eligible to be an ordinary row/unread line below — see the
      // `!soft` check after this loop.
      const blockAmount = block.flatMap((l) => l.amountParts)[0];
      for (const totalLine of totalLines) {
        const label = normaliseLabel(totalLine.text);
        // A running-balance HEADER ("Total balance 12,480.55") matches the
        // total-family shape but isn't a receipt signal at all (B2).
        if (BALANCE_VOCAB_RE.test(label)) continue;
        const kind = signalKindOf(label);
        if (!kind) continue;
        signals.push({ blockIndex, kind, soft });
        // ACCEPTED (reviewer, no change): prefers the amount on the SAME
        // line as the total-family text; only falls back to the block's
        // first amount when this particular line has none of its own
        // (e.g. an OCBC-style receipt with the amount on the next line).
        // A soft candidate is harmless here — `receiptTotal` is only ever
        // surfaced on the returned layout when `kind === 'receipt'` below.
        const amount = totalLine.amountParts[0] ?? blockAmount;
        if (!amount || kind !== 'total') continue;
        if (GRAND_TOTAL_RE.test(label)) {
          receiptTotal = { value: amount.value, text: amount.trimmed, priority: 3 };
        } else if (TOTAL_RE.test(label) && (!receiptTotal || receiptTotal.priority < 2)) {
          receiptTotal = { value: amount.value, text: amount.trimmed, priority: 2 };
        } else if (AMOUNT_DUE_RE.test(label) && !receiptTotal) {
          receiptTotal = { value: amount.value, text: amount.trimmed, priority: 1 };
        }
        // subtotal / gst / tax / service charge: signal only, never the total.
      }
      if (!soft) {
        if (!sawFirstRow) headerParts.push(block.map((l) => l.text).join(' ').trim());
        continue;
      }
      // Soft block: falls through to the ordinary row/unreadRows path
      // immediately below, exactly like any other block — sawFirstRow/
      // lastRowBlockIndex advance normally when it turns out to be a row.
    }

    const amounts = block.flatMap((l) => l.amountParts);
    if (amounts.length === 1) {
      sawFirstRow = true;
      lastRowBlockIndex = blockIndex;
      if (!soft) lastHardRowBlockIndex = blockIndex;
      const amount = amounts[0]!;
      const description = block
        .map((l) => l.text)
        .filter(Boolean)
        .join(' ')
        .trim();
      rows.push({
        dateText: lastDateText,
        value: amount.value,
        sign: amount.sign,
        description,
        amountText: amount.trimmed,
        currency: amount.currency,
      });
    } else {
      // amounts.length === 0: pure text (header/noise) — not counted.
      // amounts.length > 1: a dropped multi-amount block — count every
      // amount-bearing LINE in it (a dual-currency line is 1; several
      // merged single-amount lines are that many), not the block itself,
      // so the end summary reports how many ROWS were actually lost.
      if (amounts.length > 1) {
        unreadRows += block.filter((l) => l.amountParts.length >= 1).length;
      }
      if (!sawFirstRow) headerParts.push(block.map((l) => l.text).join(' ').trim());
    }
  }

  // Reviewer B2: `kind` is only 'receipt' when there's real receipt
  // evidence, not merely a line that happens to start with "total" or
  // "amount due" anywhere on the screen (a bank header reading "Total
  // balance 12,480.55" above an ordinary transaction list is not a
  // receipt). Evidence is either (a) at least two DISTINCT HARD signal
  // families among {subtotal, tax, total} — HEAD behaviour, untouched — or
  // (b) exactly one HARD family, but every signal sits BELOW the last HARD
  // row (a footer, not a header) AND no date line was seen anywhere (a
  // dated transaction list is a statement, never a receipt, however its
  // own footer happens to be worded).
  //
  // SOFT signals (normalisation-only matches, QA MAJOR 1) only ever ADD to
  // that evidence, never substitute for it on their own — a blocker found
  // by fuzzing: two ordinary merchant lines that each merely LOOK like a
  // total-family label after digit-remapping ("G5T Enterprises", "T0TAL
  // Sports") could otherwise combine to >= 2 "distinct families" and
  // collapse a real 4-row dated statement into a fabricated receipt. A
  // soft match can only tip the gate when the picture is already
  // receipt-SHAPED — undated, and every signal (hard or soft) sits below
  // the last HARD row (`lastHardRowBlockIndex`, not `lastRowBlockIndex` —
  // a soft block that fell through and turned out to be a row must not
  // count as "below the rows" evidence for itself). On a dated or
  // interleaved layout, soft evidence is inert.
  const distinctSignalKinds = new Set(signals.map((s) => s.kind));
  const hardSignals = signals.filter((s) => !s.soft);
  const hardKinds = new Set(hardSignals.map((s) => s.kind));
  const singleFamilyFooterReceipt =
    hardKinds.size === 1 && !dateLineSeen && hardSignals.every((s) => s.blockIndex > lastRowBlockIndex);
  const footerShaped = !dateLineSeen && signals.every((s) => s.blockIndex > lastHardRowBlockIndex);
  const receiptSignal =
    hardKinds.size >= 2 || // HEAD behaviour, untouched
    (distinctSignalKinds.size >= 2 && footerShaped) || // soft evidence only on receipt-shaped layouts
    singleFamilyFooterReceipt; // hard-only, as above

  const kind: StatementLayout['kind'] = receiptSignal
    ? 'receipt'
    : rows.length > 1
      ? 'statement'
      : rows.length === 1
        ? 'single'
        : 'unknown';

  return {
    kind,
    rows: kind === 'receipt' ? [] : rows,
    headerText: headerParts.filter(Boolean).join(' ').trim(),
    receiptTotal:
      kind === 'receipt' && receiptTotal
        ? { value: receiptTotal.value, text: receiptTotal.text }
        : null,
    unreadRows,
    text,
  };
}
