# Task 7 Report — RequirementDiagram component + wire-up

## What changed

### Created
- `src/app/(app)/spec/requirement-diagram.tsx` — new `"use client"` component `RequirementDiagram({ reqKey, html })` that:
  - Uses `useActionState<DiagramState, FormData>(generateRequirementDiagram, null)` from `./[key]/actions`
  - Prefers freshly-returned `state.html` over the stored prop via `const shown = (state?.ok === true ? state.html : null) ?? html`
  - Renders `<HtmlFrame>` when a diagram is available (from `@/components/html-frame`)
  - Shows "Generate diagram" (primary) or "Regenerate diagram" (quiet) button via `buttonClass("primary" | "quiet")`
  - Shows inline error on `state?.ok === false`

### Modified
- `src/app/(app)/spec/requirement-detail.tsx` — added import and placed `<RequirementDiagram reqKey={r.key} html={r.diagramHtml} />` between the description `<p>` and the Tasks `<div className="mt-5 border-t border-hairline pt-4">`. Both the full `/spec/[key]` page and the drawer render `RequirementDetail`, so both paths get the diagram.

## Typecheck output

```
> throughline-generate@0.0.1 typecheck
> tsc --noEmit
```
No errors. Exit 0.

## Placement confirmation

Inserted immediately after:
```tsx
{r.description && <p className="font-serif mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">{r.description}</p>}
```
And before:
```tsx
<div className="mt-5 border-t border-hairline pt-4">
  <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Tasks</h3>
```

## Self-review checklist

- [x] `shown` prefers `state.html` (fresh generation) then falls back to `html` prop (stored)
- [x] Button variants are `"primary"` and `"quiet"` — both are valid per `buttonClass` signature
- [x] Placed before Tasks section, after description
- [x] Drawer path gets it via `RequirementDetail` (same component, both page and drawer render it)
- [x] No `any` in domain code
- [x] Only two files staged and committed

## Files changed

- `src/app/(app)/spec/requirement-diagram.tsx` (created, 33 lines)
- `src/app/(app)/spec/requirement-detail.tsx` (modified, +3 lines)

## Commit

SHA: `81c6742`
Subject: `feat(spec): inline requirement diagram with generate/regenerate (REQ-017)`
Branch: `task-059-requirement-diagram`
