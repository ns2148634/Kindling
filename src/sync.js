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

/** Combine kingdom + story entries + collection into one blob for cloud storage. */
export function buildCloudState(kingdom, storyEntries, collectionEntries) {
  return {
    ...kingdom,
    codex:      storyEntries      ?? [], // 'codex' key = story store (backward-compat name)
    collection: collectionEntries ?? [],
  };
}

/** Restore cloud blob back into IDB (kingdom + story + collection stores). */
async function restoreFromCloud(cloudState) {
  const { codex = [], collection = [], ...kingdom } = cloudState;
  kingdom.id = 'v1';
  initState(kingdom);
  await idb.put('kingdom', kingdom);
  await idb.put('codex',      { id: 'v1', entries: codex });
  await idb.put('collection', { id: 'v1', entries: collection });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called on boot (after IDB load, before rendering).
 * Returns true if the local state was replaced by the remote.
 *
 * @param {object} localKingdom  — result of idb.get('kingdom','v1') (may be null)
 * @param {object} localCodex   — result of idb.get('codex','v1') (may be null)
 */
export async function syncOnBoot(localKingdom, localStory, localCollection) {
  if (!supabase) return false;

  _user = await ensureAuth();
  if (!_user) return false;

  const remote = await pullRemote();

  if (remote?.state) {
    const remoteVer = remote.version ?? 0;
    const localVer  = localKingdom?.syncVer ?? 0;

    if (isFresh(localKingdom) || remoteVer > localVer) {
      await restoreFromCloud(remote.state);
      return true;
    } else if (localVer > remoteVer) {
      await pushToRemote(buildCloudState(
        localKingdom,
        localStory?.entries ?? [],
        localCollection?.entries ?? [],
      ));
    }
  } else {
    if (!isFresh(localKingdom)) {
      await pushToRemote(buildCloudState(
        localKingdom,
        localStory?.entries ?? [],
        localCollection?.entries ?? [],
      ));
    }
  }
  return false;
}

/**
 * Schedule a debounced push after a local change.
 * Call this immediately after incrementing syncVer and persisting to IDB.
 */
export function schedulePush(kingdom, storyEntries, collectionEntries) {
  if (!supabase || !_user) return;
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    pushToRemote(buildCloudState(kingdom, storyEntries, collectionEntries));
  }, 3000);
}

/** Returns the authenticated Supabase user (null if not signed in). */
export function getUser() { return _user; }
