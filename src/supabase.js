import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Returns null if env vars are absent (dev without .env, or offline-only build).
export const supabase = (url && key) ? createClient(url, key) : null;

/**
 * Ensure an authenticated session exists.
 * - If the user already has a session (localStorage), returns it immediately.
 * - Otherwise, calls signInAnonymously() — zero UI friction.
 * Returns the User object or null on failure / offline.
 */
export async function ensureAuth() {
  if (!supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) return session.user;

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) { console.warn('[auth] anon sign-in failed:', error.message); return null; }
    return data.user;
  } catch (e) {
    console.warn('[auth] error:', e.message);
    return null;
  }
}
