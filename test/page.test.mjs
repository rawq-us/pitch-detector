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
    "addArpTrackBtn","addBeatTrackBtn","addSamplerTrackBtn","addVoiceTrackBtn","addMemoTrackBtn",
    "midiStatus",
    "loopPopup","loopFillBtn",
    // File menu bar + sessions
    "fileMenuBtn","fileMenu","recentList","sessionLabel","midiFileInput",
    // synth glide
    "glideR",
    // sample-beat section
    "sampBank","sampGridBody","sampBarsSel","sampAddBtn","sampModePlay","sampModeEdit","sampSizeOut","sampPadDetail","sampLiveRecBtn",
    // pitch-map editor
    "pitchModal","pitchRollBody","pitchTitle","pitchModeLock","pitchPrevBtn",
    // lyrics editor
    "lyrSource","lyrPreview","lyrSingers","lyrAutoSyncBtn","lyrTapSyncBtn","lyrPlayBtn","lyrExportMenu","lyrSnapBox","kbScaleLockBtn",
    "styChips","styText","styCount","vzCopyStyle","vzCopyLyrics","vzCopyTitle","vzStatus",
    // song package + AI composer
    "songModal","songTitle","songGenre","songCover","songLyrics","songExportBtn",
    "aiComposeBtn","aiModal","aiProvider","aiModel","aiKey","aiIdea","aiComposeRun","aiOpenSettings",
    // settings modal (canonical API-key editor)
    "settingsBtn","settingsModal","settingsSave","settingsTest","settingsClear","settingsStatus",
    // memo editor
    "memoModal","memoCanvas","memoChips","memoSummary","memoKeySel","memoReanalyze",
    "memoPlayBtn","memoZoomIn","memoZoomOut","memoZoomReset","memoUseKey","memoUseBpm",
    "memoLangSel","memoModelSel","memoTranscribe","memoOutputSel","memoOutputGroup","memoLyrics","memoExport",
    "chordPopup","chordRootSel","chordQualSel",
    // key/mode map
    "keyPopup","keyPopRoot","keyPopMode","keyPopDel",
  ];
  for (const id of ids) assert.ok(html.includes('id="' + id + '"'), "missing #" + id);
});

test("core functions the tests and features depend on are present", () => {
  const names = [
    "memoWorkerMain","buildMemoMidi","makeZip","crc32","memoLrc","memoLabels",
    "addMemoClip","analyzeMemoClip","startMemoRec","stopMemoRec","convertVoiceTrack",
    "serializeProject","loadProject","buildMidi","renderMix","setTimelineZoom","setMemoZoom",
    "getWhisperWorker","memoTranscribe","sttTier",
    // new in v1.8: sampler, glide, song package, AI composer
    "samplerClipEvents","spawnOscs","buildId3","memoSrt","songMetadataJson","wavBytes16",
    "encodeSongAudio","exportSongPackage","applyProjectSpec","aiParseSpec",
    "aiProjectSummary","applyProjectOps","applySectionLayout","popOutSection","saveAutosave","bindKnob",
    "openSettings","aiCfgSummary","aiLoadCfg","aiSaveCfg","aiChat",
    "newSession","saveCurrent","openSession","saveSession","setCurrentLabel","refreshRecent",
    "openPitchEditor","pitchSnapshot","semiToRate","renderPitchRoll",
    "parseLyricsDSL","lyricsToTTML","lyricsToLRC","lyricsToAIPrompt","noteNameToMidi","lyrParse","lyrAutoSync","lyrFollowTick",
    "renderLyricsLane","lyrLinesFlat","lyrSecToBeat","lyricFmtBarBeat",
    "buildSongPrompt","gatherSongPrompt","styleTagsList","renderStyleChips","persistStyleTags",
    "vozartLyricsRaw","vozartStyleRaw","vzField","vzUpdateCounts","styTokens","styToggleTag","styHasTag","highlightStyleChips",
    "parseKeyName","keysFromLyrics","keyFollowTick","keyFollowReset","renderKeyLane",
    "parseMidiFile","importMidiToProject","initWebMIDI","onMidiMessage","midiNoteOn",
    // key/mode map
    "keyAtBeat","keyChangeSummary","keyMapSorted","renderKeyLane","keyModeName",
  ];
  for (const n of names) assert.ok(src.includes("function " + n) || src.includes(n + "("), "missing " + n);
});

test("session format version is declared", () => {
  assert.match(src, /const FORMAT_VERSION = \d+/);
});

test("APP_VERSION matches package.json and is shown on the page", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const m = src.match(/const APP_VERSION="([^"]+)"/);
  assert.ok(m, "APP_VERSION constant missing");
  assert.equal(m[1], pkg.version, "index.html APP_VERSION and package.json version must be bumped together");
  assert.ok(html.includes('id="appVersion"'), "version element missing from the page");
});
