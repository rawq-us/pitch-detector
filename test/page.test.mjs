// Page-level sanity: the inline script parses, and the structural contract
// (element ids and function names the app wires together) holds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractScript } from "./extract.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const src = extractScript();

test("inline script parses as valid JavaScript", () => {
  assert.doesNotThrow(() => new Function(src));
});

test("required element ids exist in the markup", () => {
  const ids = [
    // transport & layers
    "bpmInput","tsSel","lenInput","playBtn","tlZoomIn","tlZoomOut","tlZoomReset",
    "addArpTrackBtn","addBeatTrackBtn","addVoiceTrackBtn","addMemoTrackBtn",
    "exportBtn","loopPopup","loopFillBtn",
    // memo editor
    "memoModal","memoCanvas","memoChips","memoSummary","memoKeySel","memoReanalyze",
    "memoPlayBtn","memoZoomIn","memoZoomOut","memoZoomReset","memoUseKey","memoUseBpm",
    "memoLangSel","memoModelSel","memoTranscribe","memoTranslate","memoLyrics","memoExport",
    "chordPopup","chordRootSel","chordQualSel",
  ];
  for (const id of ids) assert.ok(html.includes('id="' + id + '"'), "missing #" + id);
});

test("core functions the tests and features depend on are present", () => {
  const names = [
    "memoWorkerMain","buildMemoMidi","makeZip","crc32","memoLrc","memoLabels",
    "addMemoClip","analyzeMemoClip","startMemoRec","stopMemoRec","convertVoiceTrack",
    "serializeProject","loadProject","buildMidi","renderMix","setTimelineZoom","setMemoZoom",
    "getWhisperWorker","memoTranscribe","sttTier",
  ];
  for (const n of names) assert.ok(src.includes("function " + n) || src.includes(n + "("), "missing " + n);
});

test("session format version is declared", () => {
  assert.match(src, /const FORMAT_VERSION = \d+/);
});
