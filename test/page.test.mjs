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
    "addLayerBtn","addLayerModal","addLayerClose","layerGrid","loopMenuBtn","loopWholeBtn","undoBtn","redoBtn",
    // MIDI piano-roll editor
    "midiModal","midiRoll","midiRollWrap","midiCtrlLane","midiCtrlTabs","midiCtrlBox","midiKbHost","midiKeyTag","midiSnap","midiBars","midiPlay","midiRecBtn","midiQuant",
    // instrument sections (visualizer + full-screen editor)
    "synthModal","synthModalHost","synthEditBtn","synthLayerViz","synthControls","midiLayerViz","midiNewBtn","midiEditBtn",
    "midiLibBtn","midiLib","midiLibGenre","midiLibList","midiLibKey",
    "midiKeyRoot","midiKeyMode","synthKeyRoot","synthKeyMode","midiKeyChips","synthKeyChips","midiInKeyBtn","midiFxBtn",
    "midiKeyRuler","midiAddKeyBtn","midiZoomIn","midiZoomOut","midiVoiceHost",
    "modeMoodOut",
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
    "lyrSource","lyrPreview","lyrSingers","lyrFitBtn","lyrAutoSyncBtn","lyrTapSyncBtn","lyrPlayBtn","lyrExportMenu","lyrSnapBox","kbScaleLockBtn",
    "styChips","styText","styCount","vzCopyStyle","vzCopyLyrics","vzCopyTitle","vzStatus",
    // AI lyrics: wizard + mulligan
    "lyrWizBtn","lyrMullBtn","lyrWizModal","lyrWizGen","lwTheme","lyrMullModal","lyrMullGen","lmSel","lyrMullResults",
    // song package + AI composer
    "songModal","songTitle","songGenre","songCover","songLyrics","songExportBtn",
    "aiComposeBtn","aiModal","aiProvider","aiModel","aiKey","aiIdea","aiComposeRun","aiOpenSettings",
    // generate-backing modal (Roadmap item 4)
    "backingBtn","backingModal","backingClose","backProg","backMemoSel","backAiRoot","backAiMode",
    "backAiBars","backAiStyle","backPad","backBass","backArp","backDrums","backFeel","backBars","backingRun","backingStatus",
    // undo/redo toolbar (Roadmap item 1)
    "undoBtn","redoBtn",
    // master level meter (Roadmap item 7)
    "masterMeter","masterMeterFill",
    // live collaboration (Roadmap WebRTC)
    "collabBtn","collabModal","collabClose","collabName","collabHost","collabDisconnect","collabStatus","collabPeers",
    "collabStepStart","collabStepHost","collabStepJoin","collabStepConnected",
    "collabOffer","collabOfferCopy","collabOfferQR","collabAnswerIn","collabAnswerInBtn",
    "collabReply","collabReplyCopy","collabReplyQR","collabJoinHost","collabRoster","collabInviteMore",
    // settings modal (canonical API-key editor)
    "settingsBtn","settingsModal","settingsSave","settingsTest","settingsClear","settingsStatus","settingsResetLayout",
    // memo editor
    "tunerBtn","tunerModal","tunerInst","tunerTuning","tunerStrings","tunerMicBtn","tunerMeter","tmNote","tmNeedle","tmCents","tmTarget",
    "memoModal","memoCanvas","memoChips","memoSummary","memoKeySel","memoReanalyze",
    "memoPlayBtn","memoZoomIn","memoZoomOut","memoZoomReset","memoUseKey","memoUseBpm",
    "memoLangSel","memoModelSel","memoTranscribe","memoOutputSel","memoOutputGroup","memoLyrics","memoExport",
    "chordPopup","chordRootSel","chordQualSel",
    // key/mode map
    "keyPopup","keyPopRoot","keyPopMode","keyPopDel","keyPopSave","keySugg","keySuggFrom","keyPopMood",
    // song structure
    "structSummary","structPopup","structType","structBars","structSave","structDel","structAddMenu","structAddBtns",
    // song metadata header (genre · title · take)
    "songMetaBtn","songMetaDisplay","songMetaPopup","smTitle","smGenre","smTake",
    // first-run welcome / pitch modal
    "welcomeModal","welcomeClose","welcomeStart",
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
    "openSettings","aiCfgSummary","aiLoadCfg","aiSaveCfg","aiChat","aiComplete","resetAppSettings","addLayer",
    "buildLyricsWizPrompt","buildMulliganPrompt","parseAiVariations",
    "newSession","saveCurrent","openSession","saveSession","setCurrentLabel","refreshRecent",
    "openPitchEditor","pitchSnapshot","semiToRate","renderPitchRoll",
    "parseLyricsDSL","lyricsToTTML","lyricsToLRC","lyricsToAIPrompt","noteNameToMidi","lyrParse","lyrAutoSync","lyrFollowTick",
    "renderLyricsLane","lyrLinesFlat","lyrSecToBeat","lyricFmtBarBeat","lyrAutoDistribute","applyLyricMeta",
    "buildSongPrompt","gatherSongPrompt","styleTagsList","renderStyleChips","persistStyleTags",
    "vozartLyricsRaw","vozartStyleRaw","vzField","vzUpdateCounts","styTokens","styToggleTag","styHasTag","highlightStyleChips",
    "parseKeyName","keysFromLyrics","keyFollowTick","keyFollowReset","renderKeyLane","addKeyChangeAt","attachKeyEdgeDrag",
    "parseMidiFile","importMidiToProject","initWebMIDI","onMidiMessage","midiNoteOn",
    // key/mode map
    "keyAtBeat","keyChangeSummary","keyMapSorted","renderKeyLane","keyModeName",
    "keySuggestions","scalePCs","modeMood","songDisplayName","refreshSongMeta",
    "openSynthModal","closeSynthModal","renderInstViz","renderInstVizAll","openArpClip","setArpEditTarget",
    "renderPattern","midiLibAdd","midiLibPreview",
    "parseProgression","chordQualityFromSuffix","voiceProgression",
    "chordsToProgression","backingDrumPattern","buildBacking","buildBackingPrompt",
    "backingSrc","backingMemos","materializeBacking","runBacking","openBackingModal",
    // undo/redo (Roadmap item 1)
    "makeHistory","commit","beginEdit","endEdit","undoEdit","redoEdit","snapshotProject","restoreProject","snapClip","snapTrack","updateUndoUI",
    // clip editing (Roadmap item 2)
    "cloneClipData","splitMidiNotes","splitClipData","duplicateClip","copyClip","pasteClipAt","splitClipAt","openClipMenu","attachClipResize","playheadSec","selectClip",
    // harmony assistant (Roadmap item 5)
    "diatonicChords","triadQuality","romanFor","suggestChords","suggestProgression","voiceLead","progressionToText","chordSuffix",
    // level meters (Roadmap item 7)
    "analyserRms","analyserPeak","linToDb","dbToFrac","meterFrac","readLevel","drawMeters",
    // track automation (Roadmap item 8)
    "automationValueAt","serializeAutomation","applyLiveAutomation","buildAutomationOverlay",
    // live collaboration (Roadmap WebRTC)
    "rtcEncode","rtcDecode","peerColor","rtcStateForWire","rtcBroadcastState","rtcSendTransport","rtcOnMessage","rtcHost","rtcJoin","rtcTeardown","collabStep",
    "rtcOpenPeers","rtcInSession","rtcSendAll","rtcSendTo","updateCollabUI","rebuildRoster","onPeerConnected","dropPeer","wirePeerChannel",
    "bytesToB64url","b64urlToBytes","buildSignalUrl","parseSignalHash","packSignal","unpackSignal","checkInviteUrl","showSignalOut",
    "qrGfMul","qrRsGen","qrChooseVersion","qrMakeMatrix","renderCollabQR",
    "concatChunks","blobChunkCount","collabRegisterLocalBlobs","sendBlob","requestMissingBlobs","onBlobComplete",
    // P2P sync spec (docs/P2P_SYNC_SPEC.md)
    "uuid","myPeerId","ensureSessionId","trackHash","computeSyncBase","trackSyncMeta","reconcile","clockMedianOffset","mergeRemoteState","bumpChangedRevs",
    "midiEditorSetKey","syncSynthKeySel","fillKeySelect",
    "timelineKeys","clipKeySpan","renderKeyChips","nearestInScale","midiSnapPitch",
    "keySegmentsInClip","renderMidiKeyRuler","midiAddKeyChange","midiZoom","cloneVoice",
    "structAdd","renderStructureLane","structToLyrics","structLabel","structSorted",
    "structFromLyrics","kindToStructType","syncStructureToLyrics","lyricsBlocks","structHeader","isSectionHeaderLine",
    "tunerLiveUpdate","syncTunerMic","renderDetection","startTunerDrone","stopTunerDrone",
    "trackAudible","soloActive","applyTrackMuteSolo",
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
