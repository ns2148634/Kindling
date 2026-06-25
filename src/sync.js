/**
 * src/sync.js — local-first cloud backup via Supabase `saves` table.
 *
 * Rules:
 *  1. IndexedDB is the source of truth; Supabase is the backup.
 *  2. Always pull first on boot, then decide whether to push.
 *  3. NEVER overwrite a richer remote with a fresh (empty) local state.
 *  4. Offline: skip gracefully; push queue runs when connection returns.
 *  5. Conflict resolution: last-write-wins by syncVer counter.
 */

import { supabase, ensureAuth } from './supabase.js';
import { initState } from './state.js';
import { idb } from './idb.js';

let _user   = null;
let _timer  = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * A "fresh" local state is one that represents a newly installed app with no
 * real progress. We must never use a fresh local state to overwrite existing
 * cloud data (new phone scenario).
 */
function isFresh(kingdom) {
  if (!kingdom || !kingdom.onboarded) return true;
  if (!Array.isArray(kingdom.land) || kingdom.land.length <= 1) {
    const counts = kingdom.counts ?? {};
    if (Object.values(counts).every(v => v === 0)) return true;
  }
  return false;
}

async function pullRemote() {
  if (!supabase || !_user) return null;
  try {
    const { data, error } = await supabase
      .from('saves')
      .select('state, version')
      .eq('user_id', _user.id)
      .maybeSingle();
    if (error) { console.warn('[sync] pull error:', error.message); return null; }
    return data; // { state, version } or null
  } catch (e) {
    console.warn('[sync] pull exception:', e.message);
    return null;
  }
}

async function pushToRemote(combined) {
  if (!supabase || !_user) return;
  try {
    const { error } = await supabase.from('saves').upsert({
      user_id:    _user.id,
      state:      combined,
      version:    combined.syncVer ?? 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) console.warn('[sync] push error:', error.message);
  } catch (e) {
    console.warn('[sync] push exception:', e.message);
  }
}

/** Combine kingdom state + codex entries into one blob for cloud storage. */
export function buildCloudState(kingdom, codexEntries) {
  return { ...kingdom, codex: codexEntries ?? [] };
}

/** Restore cloud blob back into IDB (kingdom + codex stores separately). */
async function restoreFromCloud(cloudState) {
  const { codex = [], ...kingdom } = cloudState;
  kingdom.id = 'v1';
  initState(kingdom);
  await idb.put('kingdom', kingdom);
  await idb.put('codex', { id: 'v1', entries: codex });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called on boot (after IDB load, before rendering).
 * Returns true if the local state was replaced by the remote.
 *
 * @param {object} localKingdom  — result of idb.get('kingdom','v1') (may be null)
 * @param {object} localCodex   — result of idb.get('codex','v1') (may be null)
 */
export async function syncOnBoot(localKingdom, localCodex) {
  if (!supabase) return false;

  _user = await ensureAuth();
  if (!_user) return false;

  const remote = await pullRemote();

  if (remote?.state) {
    const remoteVer = remote.version ?? 0;
    const localVer  = localKingdom?.syncVer ?? 0;

    if (isFresh(localKingdom) || remoteVer > localVer) {
      // Remote is richer or local is empty → restore
      await restoreFromCloud(remote.state);
      return true;
    } else if (localVer > remoteVer) {
      // Local has more recent progress (was offline) → push
      const codexEntries = localCodex?.entries ?? [];
      await pushToRemote(buildCloudState(localKingdom, codexEntries));
    }
    // Equal versions → already in sync, nothing to do
  } else {
    // No remote save yet — push local if it has real data
    if (!isFresh(localKingdom)) {
      const codexEntries = localCodex?.entries ?? [];
      await pushToRemote(buildCloudState(localKingdom, codexEntries));
    }
  }
  return false;
}

/**
 * Schedule a debounced push after a local change.
 * Call this immediately after incrementing syncVer and persisting to IDB.
 */
export function schedulePush(kingdom, codexEntries) {
  if (!supabase || !_user) return;
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    pushToRemote(buildCloudState(kingdom, codexEntries));
  }, 3000);
}

/** Returns the authenticated Supabase user (null if not signed in). */
export function getUser() { return _user; }
