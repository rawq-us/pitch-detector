# Pitch Studio — P2P Sync Spec (no backend; QR/manual signaling stays)

Handoff spec for the WebRTC collaboration work. Drop-in, dense.

**Signaling:** unchanged. Keep the existing QR/manual offer–answer exchange.
Hosted DBs (Supabase/InstantDB/Turso/etc.) are **NOT a dependency — break-glass
only**. Once the data channel is open, *all* sync rides the WebRTC data channel;
nothing external.

---

## 1. Identity model (the reconnect question)

Add to `serializeProject()` / `loadProject()`, bump `FORMAT_VERSION`:

- `project.sessionId` — UUID minted once at project creation (`crypto.randomUUID()`).
  **Immutable.** This is the song's identity across machines — song name, tempo,
  etc. can all change and it still matches.
- Per track:
  - `track.id` — UUID, stable.
  - `track.ownerId`.
  - `track.rev` — int, `++` on any edit to that track.
  - `track.updatedAt` — wall-clock ms. **Hint only** (see §4).
- `project.syncBase` — snapshot of the last successfully-synced state (used for
  3-way merge). Store as `{ sessionId, tracks: { [trackId]: { rev, hash } } }` —
  not full audio, just per-track rev + a cheap content hash.
- `peerId` — UUID per browser/install (localStorage), used as `ownerId`.

**Reconnect detection:** on data-channel open, peers exchange
`{ sessionId, perTrackRev }`. If `sessionId` matches → same song, run reconcile
(§5). If not → offer "join as new collaborator / import as separate project."

## 2. Clock sync (mini-NTP)

On channel open, before any transport: 5–7 round-trip pings over the data channel.
`offset = remoteTime - (localSend + rtt/2)`; take the **median**. Store
`clockOffset`. Re-run on resume.

## 3. Transport kickoff

Host sends `{ cmd:'play', hostStartTime:T }` where `T` is host-clock ms slightly
in the future (e.g. `now + 250ms`). Each peer converts to local time via
`clockOffset`, schedules against Web Audio `audioCtx.currentTime` (**not**
`setTimeout`). Same pattern for count-in / record-arm so both playheads +
recordings align. Stop/seek same shape.

## 4. Live editing — per-track soft lock

Each track has `ownerId`. Only the owner edits it live; non-owners render it
read-only and apply streamed updates. Owner broadcasts edits as track-scoped ops
`{ trackId, rev, patch }`; receivers apply if `rev` is newer. Claiming: a
non-owned track can be claimed → broadcast `{ trackId, ownerId }` (last-claim-wins
is fine, it's social). This prevents most conflicts at the source.

## 5. Disconnected reconcile — 3-way, layer-level

```
reconcile(local, remote, base) -> { merged, conflicts[] }
```

Per `trackId` (union of both sides, keyed on stable track UUID):

- In neither base → added by one side → **take it** (auto).
- Changed on only one side (other side's `rev` == base `rev`) → **fast-forward**
  (auto, silent).
- Changed on both (both revs > base rev) → **conflict** → push to `conflicts[]`.
- Deleted one side, untouched other → take the delete (auto).

`conflicts[]` drives the layer-diff UI: per conflicting track show
**Keep mine / Keep theirs / Keep both as new layer**. Surface `updatedAt` and
`rev` as a **hint** ("theirs edited more recently") — never as an auto-resolver,
and gracefully absent if no timestamp. Audio merges by **arrangement metadata
only** (clip refs/positions/gain); waveforms are immutable per take. After merge,
set new `syncBase` on both peers.

**Blob transfer:** merged tracks may reference audio that lives only on the other
machine — carry blob refs in the merge result and pull missing blobs lazily over
the data channel.

## 6. Constraints

Stay in `index.html`, no build step. `crypto.randomUUID` is fine. Add `reconcile`
+ the new fields to the Node export tests where they're extractable. Bump
`FORMAT_VERSION` (old builds can't read `sessionId`/per-track sync fields).

---

**One-line summary:** sessionId UUID = song identity across machines; per-track
rev + stored syncBase enable silent 3-way fast-forwards with conflicts only when
both edited the same layer; timestamps are a hint, never an authority; signaling
stays QR/manual, no DB.

---

## Implementation status (v1.39.0)

**Done + unit-tested (test/p2psync.test.mjs) + verified in-browser:**
- §1 identity — `sessionId`, per-track `uid`/`ownerId`/`rev`/`updatedAt`, `syncBase`; serialize/load +
  snapshot carry them; `FORMAT_VERSION` 3→4. **Note:** identity lives on `track.uid`, not `track.id`
  (numeric `id` stays for runtime — chains/selection/DOM key on it; UUID retrofit was too invasive).
- rev auto-bumps on real content change (diff in `commit`/`endEdit` via `trackHash`).
- §5 reconcile — `reconcile`/`trackHash`/`computeSyncBase`/`trackSyncMeta`; `mergeRemoteState` applies it
  to incoming data-channel snapshots (per-track 3-way merge replacing whole-project clobber). Conflicts
  default keep-mine + status line.
- §2 clock offset — `clockMedianOffset` (median NTP). Computed, not yet wired to transport.

**Remaining (need a 2-browser manual test loop):**
- §3 transport kickoff scheduled against `audioCtx.currentTime` via `clockOffset` (+ count-in / record-arm).
- §4 per-track soft-lock live ops `{trackId, rev, patch}` + claim (owner-only live edit; non-owners read-only).
- Conflict-resolution UI (Keep mine / theirs / both-as-new-layer) driven by `reconcile().conflicts`.
- Chunked **audio-blob transfer** over the data channel so recorded stems are audible on every peer
  (currently structure syncs; audio bytes don't cross the wire — remote-added tracks arrive silent).
- **Multi-person host-relay** topology (one peer rebroadcasts to all) for >2 collaborators.
- **MediaStream voice/video** chat on the same connection.
