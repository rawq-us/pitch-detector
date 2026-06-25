# v3 plan — adopt a minimal build to unlock i18n/SEO, modules, and smaller assets

Status: **planned, not started.** v3 is the version that intentionally relaxes the
v1/v2 hard constraint of "no build step." Everything below is deferred until v3 is
opened; v2 stays single-file and build-free.

## Why v3 lifts the no-build rule
Three goals we've hit that are **unreachable** with pure client-side, no-build code:
1. **Multilingual SEO** — crawlers need translated strings in the *served* HTML, on
   distinct per-language URLs, with `hreflang`. No client-side runtime swap achieves
   this; the words must be baked into static files. That requires a generation step.
2. **Maintainability at 8.7k lines** — authored modules + dead-code elimination need
   a bundler; we deliberately did NOT split the file by hand in v2.
3. **Smaller shipped assets** — minification alone cuts the current file ~40–50%.

The key reassurance, unchanged: **build-time deps ≠ runtime deps.** What ships stays
dependency-free static HTML (one self-contained file per language). Vite/FormatJS
never reach the user. The "build server" is a pre-push CI step, not a runtime.

## Decided stack
- **Bundler:** **Vite** + **`vite-plugin-singlefile`** — gives modules, tree-shaking,
  dead-code elimination, minification; inlines all JS/CSS back into one self-contained
  `index.html`. Run once per locale → one file per language.
- **i18n:** **FormatJS** — `@formatjs/intl` runtime (vanilla, real ICU MessageFormat)
  + `@formatjs/cli` to extract messages into per-locale JSON. ICU is required for
  correct plurals/gender/number/date across languages. (Lingui is the alternative if
  we want lighter authoring DX; i18next rejected — heavy runtime, built for the
  SEO-poor client-swap pattern.)
- **No SPA framework.** Solid/React were considered and rejected: a reactive rewrite
  of the imperative Web-Audio core is high-risk for no perf win (the bottleneck is DSP,
  not DOM). Vite gives the wins (modules, DCE, size) without the rewrite.

## Build target — one self-contained file PER LANGUAGE
`/` (en) · `/es/` · `/fr/` … each with strings baked into HTML, localized
`<title>`/`<meta>`/`og:`, `<html lang dir>` set, and a reciprocal `hreflang` cluster +
canonical. This is the SEO-correct target and the reason for the build. (A single
combined "one main file" with runtime switching reverts the SEO win — only revisit if
the landing content no longer needs to rank.)

## Pipeline
```
src/ (modular)   ──vite build × locale──▶  dist/index.html      (en + hreflang)
locales/*.json                             dist/es/index.html   (baked strings)
                                           dist/fr/index.html
```
1. `@formatjs/cli extract` → `locales/en.json` (source of truth); translators fill the rest.
2. Vite builds per locale, injecting that catalog; singlefile inlines everything.
3. Static UI strings baked at build time (crawler-visible). The small FormatJS runtime
   stays only for **dynamic** strings (e.g. "flexed to 206 BPM", alerts) and an optional
   `navigator.language` redirect from `/`.
4. Deploy `dist/` to GitHub Pages — still static, no server.

## Maintainability work this unlocks (deferred from the v2 redesign)
- Split `index.html` into authored ES modules; the bundler reassembles to one file.
- The JS structural consolidation we held back: shared modal open/close helper, one
  key/mode selector primitive, a clip-buffer playback helper (the 4× `createBufferSource`
  block), a button factory. Safe to do once modules exist.
- Finish the v2 long-tail: ~60 remaining emoji → icons, fuse in-modal button rows into
  `.seg`, per-modal fullscreen audit.

## Test-harness change (must do early in v3)
`test/extract.mjs` currently lifts functions out of `index.html`. Once `index.html` is
*generated*, the suite runs against the **built** `dist/index.html` (CI: build → test),
or against the canonical `en` build / the source modules directly. Keep the page-contract
(`page.test.mjs`) + DSP (`flex.test.mjs`, `dsp.test.mjs`) tests green across the move.

## Constitution amendment (when v3 opens)
`CLAUDE.md` "Hard constraints" change: **one file → one file per language (built)**;
**no build step → a Vite pre-deploy build, dev-deps only, static single-file output per
language**. Static hosting / no-runtime-deps / lazy-ML constraints all still hold.

## The real cost
String-tagging — hundreds of literals → message ids — is the labor, same with or without
a build (FormatJS automates *finding/cataloging*, you still wrap each call site once).
Do it incrementally, surface by surface, like the icon migration.
