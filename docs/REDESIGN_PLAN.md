# v2 redesign — execution plan (rack / true-black / vivid, themeable)

Branch: `v2-redesign` (off `main` @ flex-time v2.0.0). Recover functionality from
`roadmap-1x` / `main` if anything regresses. Guard rail: `npm test` (117 tests)
must stay green — it enforces a contract of element IDs + function names that the
redesign **must not** remove or rename. CSS/classes/icons are free to change.

## Goals (definition of done)
1. **Themeable color system** — a token layer where swapping a theme block restyles
   the whole app. Ship ≥2 themes (default `rack`, plus `classic` = old look, plus
   `midnight`). A `setTheme()` fn + persisted choice + a selector in Settings.
2. **True-black, vivid rack aesthetic** — surfaces near-black neutral; layer type
   icon ⇄ waveform ⇄ clip share one vivid hue; consistent control sizing.
3. **Components** — one `.btn` (sizes/variants), fused segmented `.seg` (container
   owns border+radius, buttons borderless), consistent inputs, `.lcd` readouts.
4. **Icons not emoji** — inline SVG `<symbol>` sprite; replace emoji glyphs.
5. **Sections keep** grab/collapse/pop-out; **layers keep** FX/Auto(→sliders icon)/
   M/S/Delete + output dropdown. Editor modals standardize to fullscreen.
6. **Flex-time tempo work retained** (already in this branch from v2.0.0).
7. **Dead code removed** where safe (never touch contract IDs/functions).
8. **Tests green**, browser-verified, screenshotted, committed per phase.

## Phases (loop until all done + tested)
- **P1 Theme foundation** — rewrite `:root` into palette → semantic → legacy-alias
  layers + spacing/radius/type scales + alt theme blocks. Legacy aliases mean the
  whole app re-skins immediately. `setTheme()` + persistence + Settings selector.
- **P2 Tokenize CSS** — replace hardcoded hexes in the `<style>` block with tokens
  so every surface themes and matches the palette.
- **P3 Components + icon sprite** — add `.btn/.seg/.lcd/.field/.tico` classes and the
  SVG symbol sprite; helper to emit icons.
- **P4 Surface migration** — transport, timeline/track headers (color-coded type
  icons), section chrome, editor modals → fullscreen, button groups → `.seg`, emoji
  → icons. Preserve all IDs/functions.
- **P5 Dead code** — remove orphaned (non-contract) functions + dead CSS.
- **P6 Verify + release** — `npm test` green, browser smoke + screenshot, bump notes,
  commit each phase on `v2-redesign`.

Each phase ends with `npm test` green and a commit. Quick syntax gate:
`awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' index.html | node --check /dev/stdin`
