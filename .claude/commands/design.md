# /design <screen / flow / UI idea>

Mock up UI as a shareable artifact BEFORE any code is written. The deliverable
is a direction the user can react to — never an implementation. On approval,
hand off to /ship (the mockup URL goes into the spec).

## Method (proven on the command-discoverability round)
1. **Ground in the real app first.** Read `src/theme/tokens.ts` (BOTH
   darkColors and lightColors — verbatim hexes), the actual screen/component
   code being redesigned, and recent device screenshots in the conversation.
   Never invent colors, spacing, or copy the app doesn't have; the mockup's
   credibility is that it looks like the app.
2. **Load the `artifact-design` skill**, then build ONE self-contained HTML
   page (no external requests):
   - Phone-frame mockups: **before (current, dimmed) vs after (proposed)**
     side by side — the comparison is the argument.
   - A **☾/☀ toggle** switching every phone between the app's two palettes
     (scope theme tokens to the frames; page chrome stays fixed). Keep the
     same favicon across redeploys of the same design.
   - Captions that say WHY, not just what; call out what's unchanged; a
     footer noting "MOCKUP · not pixel-final · palettes from tokens.ts".
   - Multiple genuinely-different options only when there's a real fork —
     label a recommendation.
3. **Publish via Artifact** (file in the scratchpad; keep the same file path
   when iterating so the URL is stable) and summarize the design argument in
   chat: the problem, the moves, the one thing you'd flag as a risk or taste
   call.
4. **Stop.** Do not write app code, do not spec, do not launch agents. Wait
   for the user's reaction; iterate the mockup on feedback (regenerate +
   redeploy, seconds). On "looks good / spec it / ship it" → /ship, with the
   spec's Objective linking the mockup URL and the approved option named.

## Reality rules
- Respect platform truth: don't mock what iOS can't do (e.g. text input in
  widgets); say so and mock the honest alternative.
- The in-app avatar, icons (`src/theme/assets.ts`), radii (`radius.pill` etc.)
  and copy tone are part of the system — reuse, don't restyle.
- If the idea is really a product/strategy question with no visual fork,
  say so and suggest /discuss instead of forcing pixels onto it.
