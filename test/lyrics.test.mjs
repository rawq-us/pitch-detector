// Lyrics backbone tests: the bracket/paren DSL parses into the granular model
// (singers · sections · word tokens with pitch), and distills to the standard
// formats (plain · DSL round-trip · LRC · SRT · Apple-Music TTML). Lifted out of
// index.html — these builders are DOM-free by design.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
function sandbox(){
  const names = [
    "noteNameToMidi","midiToNoteName","lyricSectionKind","parseLyricLine","parseLyricsDSL","parseKeyName",
    "lyricLineText","lyricDocLines","lyricTimeLRC","lyricTimeSRT","wrapBgParens","lyricFmtBarBeat",
    "lyricsToPlain","lyricsToDSL","lyricsToAIPrompt","lyricsToLRC",
    "lyricsToSRT","lyricsToTTML","buildSongPrompt","lyricLineClean",
    "buildLyricsWizPrompt","buildMulliganPrompt","parseAiVariations",
  ];
  const body = names.map(n => extractFunction(src, n)).join("\n");
  return new Function(body + "\nreturn { " + names.join(",") + " };")();
}
const L = sandbox();

const SONG = `[Rapper A: C2–G5 florida drawl]
[Rapper B: E2–E4 - georgia drawl - bass]

[Verse 1 - Rapper A]
I see you vibin' in the frost, lookin' main character.

[Chorus - bass vocals - Rapper B - autotune]
[B2]How you getting [E3]cold [F#2]under [G2]all that [B2]sweater?

[blues guitar solo]

[Pre-chorus - female vocals]
I was the risk, the reward, the dankest sticky weed,
(background ooh)`;

test("noteNameToMidi: standard pitch spellings", () => {
  assert.equal(L.noteNameToMidi("C4"), 60);
  assert.equal(L.noteNameToMidi("B2"), 47);
  assert.equal(L.noteNameToMidi("F#2"), 42);
  assert.equal(L.noteNameToMidi("E3"), 52);
  assert.equal(L.noteNameToMidi("nope"), null);
  assert.equal(L.midiToNoteName(60), "C4");
});

test("parseLyricsDSL: singers, sections, assignments, kinds", () => {
  const doc = L.parseLyricsDSL(SONG);
  assert.equal(doc.singers.length, 2);
  const a = doc.singers.find(s => s.name === "Rapper A");
  assert.equal(a.low, L.noteNameToMidi("C2"));
  assert.equal(a.high, L.noteNameToMidi("G5"));
  assert.match(a.style, /florida drawl/);
  const kinds = doc.sections.map(s => s.kind);
  assert.deepEqual(kinds, ["verse", "chorus", "instrumental", "prechorus"]);
  const chorus = doc.sections.find(s => s.kind === "chorus");
  assert.equal(chorus.singerId, doc.singers.find(s => s.name === "Rapper B").id);
  assert.ok(doc.sections.find(s => s.kind === "instrumental").instrumental);
});

test("parseKeyName: note + mode spellings → {root, mode}", () => {
  assert.deepEqual(L.parseKeyName("A minor"), { root: 9, mode: "aeolian" });
  assert.deepEqual(L.parseKeyName("F# dorian"), { root: 6, mode: "dorian" });
  assert.deepEqual(L.parseKeyName("Bb mixolydian"), { root: 10, mode: "mixolydian" });
  assert.deepEqual(L.parseKeyName("C"), { root: 0, mode: "ionian" });       // bare note = major
  assert.deepEqual(L.parseKeyName("G major"), { root: 7, mode: "ionian" });
  assert.equal(L.parseKeyName("nope"), null);
});

test("parseLyricsDSL: [Key:]/[Musical Mode:]/[Tempo:] are directives, NOT singers", () => {
  const doc = L.parseLyricsDSL("[Rapper A: C2-G5 - male]\n[Musical Mode: Dorian]\n[Key: C#]\n[Tempo: 96]\n\n[Verse 1 - Rapper A]\nhello world");
  // only the real singer — "Musical Mode" and "Key" must not become singers
  assert.equal(doc.singers.length, 1);
  assert.equal(doc.singers[0].name, "Rapper A");
  // directives land in doc.meta
  assert.equal(doc.meta.keyRoot, 1);          // C# = 1
  assert.equal(doc.meta.keyMode, "dorian");
  assert.equal(doc.meta.bpm, 96);
});

test("parseLyricsDSL: section 'Key A#' (no colon) is read as the section key", () => {
  const doc = L.parseLyricsDSL("[Chorus - Key A#]\nspit on it");
  const chorus = doc.sections.find(s => s.kind === "chorus");
  assert.deepEqual(chorus.key, { root: 10, mode: "ionian" });   // A# major
});

test("parseLyricsDSL: inline [Section - key: …] sets section.key without breaking singers", () => {
  const doc = L.parseLyricsDSL("[Lead: C3-A4 warm]\n\n[Chorus - Lead - key: A minor]\nHow you getting cold");
  assert.equal(doc.singers.length, 1);                         // the singer def still parses (colon precedes no " - ")
  const chorus = doc.sections.find(s => s.kind === "chorus");
  assert.deepEqual(chorus.key, { root: 9, mode: "aeolian" });  // the key attr is read
  assert.equal(chorus.singerId, doc.singers[0].id);            // and the singer assignment survives
  // a singer whose style contains " - " is NOT mistaken for a section
  const d2 = L.parseLyricsDSL("[Rapper B: E2–E4 - georgia drawl - bass]");
  assert.equal(d2.singers.length, 1);
});

test("parseLyricsDSL: inline [Note] pitch tags attach to the next word", () => {
  const doc = L.parseLyricsDSL(SONG);
  const chorus = doc.sections.find(s => s.kind === "chorus");
  const toks = chorus.lines.find(l => l.tokens.length).tokens;
  assert.equal(toks[0].text, "How");  assert.equal(toks[0].pitch, L.noteNameToMidi("B2"));
  assert.equal(toks[1].text, "you");  assert.equal(toks[1].pitch, null);
  const cold = toks.find(t => t.text === "cold");
  assert.equal(cold.pitch, L.noteNameToMidi("E3"));
});

test("parseLyricsDSL: parens mark background tokens", () => {
  const doc = L.parseLyricsDSL(SONG);
  const pre = doc.sections.find(s => s.kind === "prechorus");
  const bgLine = pre.lines.find(l => l.tokens.some(t => t.bg));
  assert.ok(bgLine, "a background line exists");
  assert.ok(bgLine.tokens.every(t => t.bg));
  assert.equal(bgLine.role, "background");
});

test("lyricsToDSL: round-trips singers, sections, pitch tags and background", () => {
  const doc = L.parseLyricsDSL(SONG);
  const round = L.parseLyricsDSL(L.lyricsToDSL(doc));
  assert.equal(round.singers.length, doc.singers.length);
  assert.deepEqual(round.sections.map(s => s.kind), doc.sections.map(s => s.kind));
  const c1 = doc.sections.find(s => s.kind === "chorus").lines.find(l => l.tokens.length);
  const c2 = round.sections.find(s => s.kind === "chorus").lines.find(l => l.tokens.length);
  assert.equal(c2.tokens[0].pitch, c1.tokens[0].pitch);   // [B2] survived the round-trip
});

test("lyricsToTTML: agents per singer + background role", () => {
  const ttml = L.lyricsToTTML(L.parseLyricsDSL(SONG));
  assert.match(ttml, /<tt\b/);
  assert.match(ttml, /ttm:agent/);
  assert.match(ttml, /Rapper A/);
  assert.match(ttml, /ttm:role="x-bg"/);   // the (background ooh) line
});

test("lyricsToLRC/SRT: line-level beat timing distills to seconds (tempo-aware)", () => {
  const doc = L.parseLyricsDSL(SONG);
  const spb = 0.5;   // seconds per beat (120 BPM)
  assert.equal(L.lyricsToLRC(doc, spb).trim(), "");   // nothing synced yet (no line.beat)
  // assign the first line a beat position of 2 beats → 1.00s at this tempo
  const line = L.lyricDocLines(doc)[0].ln;
  line.beat = 2;
  assert.match(L.lyricsToLRC(doc, spb), /^\[00:01\.00\]/);
  assert.match(L.lyricsToSRT(doc, spb), /00:00:01,000 --> /);
  // tempo-independence: at half the secPerBeat the same beat is half the time
  assert.match(L.lyricsToLRC(doc, 0.25), /^\[00:00\.50\]/);
  // AI prompt with bar·beat carries the musical position
  assert.match(L.lyricsToAIPrompt(doc, { withTimes: true, bpb: 4 }), /\[1\.3\]/);   // beat 2 → bar 1, beat 3
});

test("buildSongPrompt: emits a flat tempo-first tag line + structure + key changes + lyrics", () => {
  const out = L.buildSongPrompt({
    meta: { title: "Frost", artist: "Nobody", bpm: 74, timeSig: "4/4", key: "A minor" },
    styleTags: ["boom-bap", "Hip-Hop", "Funk", "Male Lead", "Organ", "dusty", "sub-heavy"],
    instruments: ["arpeggiated synth", "drum machine"],
    singers: ["Lead — warm", "BGV — airy"],
    keyChanges: ["bar 17: C major", "bar 33: A minor"],
    structure: "• Verse 1 — Lead @ bar 1.1\n• Chorus — Lead @ bar 17.1 · key C major",
    lyrics: "[Verse 1 - Lead]\n[1.1] I see you",
  });
  // tempo leads the tag line (Vozart "74bpm" form), then the descriptive tags
  assert.match(out, /Style tags: 74bpm, boom-bap, Hip-Hop, Funk, Male Lead, Organ, dusty, sub-heavy/);
  assert.match(out, /Time & key: 4\/4 · key A minor/);
  assert.match(out, /Key\/mode changes: bar 17: C major; bar 33: A minor/);
  assert.match(out, /Arrangement already built: arpeggiated synth, drum machine/);
  assert.match(out, /Voices: Lead — warm; BGV — airy/);
  assert.match(out, /Structure \(bar·beat\):/);
  assert.match(out, /\[Verse 1 - Lead\]/);
  // explicitly steers the model off trademarked names
  assert.match(out, /no artist, song, or album names/);
  // empty inputs are omitted, not rendered blank
  const lean = L.buildSongPrompt({ meta: {}, styleTags: [], lyrics: "" });
  assert.doesNotMatch(lean, /Style tags:/);
  assert.doesNotMatch(lean, /undefined/);
});

test("lyricLineClean: keeps (background) parens, drops pitch tags and timing", () => {
  const doc = L.parseLyricsDSL("[Chorus - Lead]\n[4.2] [C4]This [E4]is [G4]the hook,\n(ooh) let it ring.");
  const chorus = doc.sections.find(s => s.kind === "chorus");
  const lines = chorus.lines.filter(l => l.tokens.length);
  // line with [C4]…[G4] pitch tags → words only, no [Note] tags
  const sung = L.lyricLineClean(lines[0]);
  assert.equal(sung, "This is the hook,");
  assert.doesNotMatch(sung, /\[[A-G]/);
  // inline (ooh) background survives the parens, the rest stays plain
  const bg = L.lyricLineClean(lines[1]);
  assert.equal(bg, "(ooh) let it ring.");
});

test("buildLyricsWizPrompt: folds the config into a structured request", () => {
  const p = L.buildLyricsWizPrompt({
    theme: "late night drive", style: "moody synth-pop", genre: "synth-pop", singers: "female lead",
    bpm: "92", keyRoot: "C#", mode: "Dorian",
    verses: 3, coupletsPerVerse: 2, coupletsPerChorus: 2, chorusRepeatEvery: 4,
    syllables: 8, form: "strict rhyme", rhyme: "AABB",
    intro: true, outro: false, bridge: true, bridgeAfter: "after the 2nd chorus", allowDup: false,
  });
  assert.match(p, /Theme \/ about: late night drive/);
  assert.match(p, /do NOT print the names/);                 // names are inferred, not echoed
  assert.match(p, /3 verses of 2 couplets each/);
  assert.match(p, /hook line repeated every 4 lines/);
  assert.match(p, /an intro; no outro; a bridge after the 2nd chorus/);
  assert.match(p, /rhyme scheme: AABB/);
  assert.match(p, /about 8 syllables per line/);
  assert.match(p, /do not rhyme a word with itself/);
  assert.match(p, /tempo: 92 BPM, key: C#, mode: Dorian/);
  // unspecified music → "choose a fitting…"
  const lean = L.buildLyricsWizPrompt({ theme: "x", verses: 1, coupletsPerVerse: 1, coupletsPerChorus: 1 });
  assert.match(lean, /choose a fitting BPM, key: choose a fitting key/);
});

test("buildMulliganPrompt: includes selection, full lyrics, comments, and asks for N JSON variations", () => {
  const p = L.buildMulliganPrompt({ selection: "the hook line", fullLyrics: "[Verse 1]\nfull song here", comments: "punchier", n: 6 });
  assert.match(p, /the hook line/);
  assert.match(p, /full song here/);
  assert.match(p, /What to change: punchier/);
  assert.match(p, /exactly 6 distinct variations/);
  assert.match(p, /"variations"/);
  // default comment when none supplied
  assert.match(L.buildMulliganPrompt({ selection: "x", fullLyrics: "y" }), /make it fresher and stronger/);
});

test("parseAiVariations: JSON object, bare array, and numbered-list fallbacks", () => {
  assert.deepEqual(L.parseAiVariations('{"variations":["a","b","c"]}'), ["a", "b", "c"]);
  assert.deepEqual(L.parseAiVariations('```json\n{"variations":["x","y"]}\n```'), ["x", "y"]);
  assert.deepEqual(L.parseAiVariations('["p","q"]'), ["p", "q"]);
  assert.deepEqual(L.parseAiVariations("1. first\n2. second\n3. third"), ["first", "second", "third"]);
  assert.deepEqual(L.parseAiVariations(""), []);
});
