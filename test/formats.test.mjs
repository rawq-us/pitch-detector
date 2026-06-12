// Export-format tests: the bundle's portability promise (SMF MIDI, zip,
// LRC, Audacity labels) is validated structurally here, in Node, by lifting
// the builder functions out of index.html.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction, extractConstLine } from "./extract.mjs";

const src = extractScript();

function buildSandbox(){
  const parts = [
    extractConstLine(src, "NOTE_NAMES"),
    extractConstLine(src, "MEMO_QUALS"),
    extractConstLine(src, "clamp"),
    extractConstLine(src, "u16"),               // declares u16 + u32 on one line
    extractConstLine(src, "CRC_TABLE"),
    extractFunction(src, "modeLabel"),
    extractFunction(src, "memoChordLabel"),
    extractFunction(src, "writeVarLen"),
    extractFunction(src, "strBytes"),
    extractFunction(src, "trackChunk"),
    extractFunction(src, "crc32"),
    extractFunction(src, "makeZip"),
    extractFunction(src, "memoLrc"),
    extractFunction(src, "memoLabels"),
    extractFunction(src, "buildMemoMidi"),
  ].join("\n");
  const project = { timeSig: { num: 4, den: 4 }, bpm: 90 };
  return new Function("project", parts + `
    return { writeVarLen, crc32, makeZip, memoLrc, memoLabels, buildMemoMidi, memoChordLabel };
  `)(project);
}
const fns = buildSandbox();

test("MIDI variable-length quantities match the SMF spec vectors", () => {
  const vec = [[0,[0x00]],[0x40,[0x40]],[0x7F,[0x7F]],[0x80,[0x81,0x00]],[0x2000,[0xC0,0x00]],[0x3FFF,[0xFF,0x7F]],[0x4000,[0x81,0x80,0x00]],[0x0FFFFFFF,[0xFF,0xFF,0xFF,0x7F]]];
  vec.forEach(([n, bytes]) => assert.deepEqual(fns.writeVarLen(n), bytes, "varlen " + n));
});

test("crc32 matches the standard check value", () => {
  const u8 = new TextEncoder().encode("123456789");
  assert.equal(fns.crc32(u8), 0xCBF43926);
});

const clip = {
  audioDur: 8,
  analysis: {
    beats: Array.from({ length: 16 }, (_, i) => +(0.1 + i * 0.5).toFixed(3)), // 120 BPM map
    bpm: 120, downbeat: 0, beatsPerBar: 4,
    key: { root: 0, mode: "ionian", conf: 0.9 },
    usedKey: { root: 0, mode: "ionian" },
    chords: [
      { start: 0.1, end: 2.1, root: 0, quality: "",  conf: 1.5, diatonic: true },
      { start: 2.1, end: 4.1, root: 9, quality: "m", conf: 1.4, diatonic: true },
      { start: 4.1, end: 6.1, root: 5, quality: "",  conf: 1.5, diatonic: true },
      { start: 6.1, end: 8.0, root: 7, quality: "",  conf: 1.4, diatonic: true },
    ],
    notes: [
      { start: 0.5, dur: 0.8, midi: 72, cents: 0,  centsToScale: 0,   conf: 0.9 },
      { start: 1.5, dur: 0.8, midi: 76, cents: 12, centsToScale: 12,  conf: 0.8 },
    ],
  },
  lyricsWords: [ { start: 0.5, end: 1.2, text: "hold" }, { start: 1.5, end: 2.2, text: "me" }, { start: 4.0, end: 4.8, text: "now" } ],
  lyricsText: "hold me now",
};

function parseSmf(data){
  assert.equal(String.fromCharCode(...data.slice(0, 4)), "MThd");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const fmt = dv.getUint16(8), nTracks = dv.getUint16(10), ppqn = dv.getUint16(12);
  const tracks = [];
  let p = 14;
  for (let t = 0; t < nTracks; t++){
    assert.equal(String.fromCharCode(...data.slice(p, p + 4)), "MTrk", "track magic " + t);
    const len = dv.getUint32(p + 4);
    const body = data.slice(p + 8, p + 8 + len);
    const evs = [];
    let i = 0, tick = 0;
    const vlen = () => { let v = 0; for (;;){ v = (v << 7) | (body[i] & 0x7F); if (!(body[i++] & 0x80)) return v; } };
    while (i < body.length){
      tick += vlen();
      const st = body[i];
      if (st === 0xFF){
        const type = body[i + 1]; i += 2;
        const ln = vlen();
        evs.push({ tick, meta: type, data: body.slice(i, i + ln) }); i += ln;
      } else {
        assert.ok(st >= 0x80, "running status not used by our writer");
        evs.push({ tick, status: st, d1: body[i + 1], d2: body[i + 2] }); i += 3;
      }
    }
    assert.equal(evs[evs.length - 1].meta, 0x2F, "end-of-track present");
    tracks.push(evs);
    p += 8 + len;
  }
  assert.equal(p, data.length, "no trailing bytes");
  return { fmt, ppqn, tracks };
}

test("memo MIDI: SMF-1 with tempo map, key signature, chord markers, melody, timed lyrics", () => {
  const smf = parseSmf(fns.buildMemoMidi(clip));
  assert.equal(smf.fmt, 1);
  assert.equal(smf.ppqn, 480);
  assert.equal(smf.tracks.length, 3, "conductor + melody + chords");
  const [cond, mel, chd] = smf.tracks;
  assert.ok(cond.some(e => e.meta === 0x51), "tempo event");
  assert.ok(cond.some(e => e.meta === 0x58), "time signature");
  assert.ok(cond.some(e => e.meta === 0x59), "key signature");
  const markers = cond.filter(e => e.meta === 0x06).map(e => String.fromCharCode(...e.data));
  assert.deepEqual(markers, ["C", "Am", "F", "G"]);
  const tempo = cond.find(e => e.meta === 0x51);
  const us = (tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2];
  assert.ok(Math.abs(60e6 / us - 120) < 1.5, "tempo ≈120 BPM, got " + (60e6 / us).toFixed(1));
  assert.equal(mel.filter(e => e.status === 0x90).length, 2, "melody note-ons");
  assert.equal(mel.filter(e => e.meta === 0x05).length, 3, "lyric events");
  assert.equal(chd.filter(e => e.status === 0x91).length, 4 * 3, "chord track: 4 triads");
  for (const tr of smf.tracks){
    let last = -1;
    for (const e of tr){ assert.ok(e.tick >= last, "ticks monotonic"); last = e.tick; }
  }
});

test("zip: store-only archive with valid signatures, CRCs and central directory", async () => {
  const enc = new TextEncoder();
  const files = [
    { name: "a.txt", data: enc.encode("hello pitch studio") },
    { name: "b.mid", data: fns.buildMemoMidi(clip) },
  ];
  const blob = fns.makeZip(files);
  const data = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(data.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50, "local file header signature");
  const eocd = data.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50, "end-of-central-directory signature");
  assert.equal(dv.getUint16(eocd + 8, true), files.length, "entry count");
  // verify each local header's CRC against our own crc32 of the payload
  let p = 0;
  for (const f of files){
    assert.equal(dv.getUint32(p, true), 0x04034b50);
    const crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true), nameLen = dv.getUint16(p + 26, true);
    assert.equal(size, f.data.length);
    assert.equal(crc, fns.crc32(f.data), f.name + " crc");
    p += 30 + nameLen + size;
  }
});

test("LRC: timestamped lines, gaps >0.8 s start a new line", () => {
  const lrc = fns.memoLrc(clip);
  assert.equal(lrc, "[00:00.50]hold me\n[00:04.00]now\n");
});

test("Audacity labels: tab-separated start/end/label rows", () => {
  const rows = fns.memoLabels(clip.analysis.chords.map(s => ({ start: s.start, end: s.end, label: fns.memoChordLabel(s) }))).trim().split("\n");
  assert.equal(rows.length, 4);
  rows.forEach(r => assert.match(r, /^\d+\.\d{6}\t\d+\.\d{6}\t\S+$/));
  assert.ok(rows[0].endsWith("\tC") && rows[1].endsWith("\tAm"));
});
