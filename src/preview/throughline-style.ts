/**
 * The Throughline ledger aesthetic, shared by every LLM→HTML explainer graphic
 * (requirement diagrams, issue previews) so they cannot drift apart. The palette
 * mirrors the committed @theme tokens in src/app/globals.css. Keep this as the
 * single source of the look; each generator composes it with its own subject and
 * output contract (ROLE + THROUGHLINE_STYLE + OUTPUT_CONTRACT).
 */
export const THROUGHLINE_STYLE = `THROUGHLINE LEDGER AESTHETIC — apply exactly.
The mood is calm, precise, archival: "iron-gall ink on cool ledger paper," with a
single verdigris thread as the only accent. Restraint over decoration. This is one
leaf in an archival record — quiet and considered, never busy or loud.

SELF-CONTAINED: ONE HTML document, inline <style> only. No external resources, no
network, no <script>, no <img>/raster images, and NO web fonts. Everything must be
drawn with HTML/CSS and inline SVG.

PALETTE — use ONLY these, by role. Never invent colors; never use neon or saturated
fills. Color is structural, not decorative.
- Paper background #ECEAE3 (cool bone — NOT warm cream/beige) · raised surface #F4F2EC · recessed well #E4E1D8
- Ink (primary text & strokes) #1A1D2E · soft ink #3B3F4F · secondary text #5A5E6B
- Hairline (1px rules, borders, dividers) #D6D2C8
- Verdigris "throughline" accent #2E7D6B · deep #245F52 (for accent text on paper) · wash #E0E9E4 (tints/fills)
- Status, muted and only when meaning requires it: done #2F7D4F · planned #B0790F · risk #B23A2E
  (each with a faint wash: #E4EDE5 / #F1E9D6 / #F1E0DC)

TYPOGRAPHY — system stacks only (no web fonts):
- Headings & labels: a humanist/grotesque sans —
  font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif.
  Weight carries hierarchy (700 headings, 500 labels, 400 body). Heading letter-spacing
  about -0.01em; never tighter than -0.04em. Use text-wrap: balance on headings.
- The one short "why"/analogy line, if any (use sparingly, at most once):
  font-family: Georgia, "Times New Roman", serif; italic.
- Every requirement/task identifier (REQ-NNN, TASK-NNN), count, metric, and date:
  font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
  with tabular figures (font-feature-settings: "tnum" 1). Identifiers are the vocabulary.
- Body measure ~60–65ch max.

SIGNATURE — the throughline spine: when the idea is a sequence, a before→after, or a
causal flow, render it as ONE verdigris thread (#2E7D6B, ~2px) with small circular
nodes along it — a FILLED node = done/happened, a HOLLOW node (paper fill + 2px
verdigris ring) = planned/upcoming, a risk node = a #B23A2E ring. This is the brand
device; reach for it wherever a real flow exists, but DO NOT force it onto content
that isn't a sequence.

ICONOGRAPHY: inline SVG line icons only — about 1.75px stroke, stroke="currentColor",
round line caps/joins, no fills. NO emoji as icons. NO raster images.

LAYOUT: a centered column, ~900px max width, generous whitespace and a calm vertical
rhythm. Prefer hairline rules to separate sections over nested boxes; at most ONE
light surface lift (#F4F2EC) where grouping genuinely helps. Establish hierarchy with
size, space, and weight — not color alone; never rely on color by itself to carry
meaning (pair it with a label, icon, or position).

CONTRAST: body and secondary text must stay clearly legible on paper (≥4.5:1) — use
the ink / soft-ink / secondary colors above, never light gray on the tint.

STATIC-SAFE: ALL content must be visible without animation — this may be captured as a
static image, so never gate visibility on a transition or reveal. Any motion must be
subtle and wrapped in @media (prefers-reduced-motion: reduce).

ABSOLUTE BANS (if tempted, rewrite the element): emoji used as icons; colored left/right
side-stripe accent borders; gradient text or background-clip:text; decorative
glassmorphism/blur; rows of identical repeated cards; a tiny uppercase wide-tracked
"eyebrow" label over every block; any color used purely for decoration. Calm and
archival always beats loud.`;
