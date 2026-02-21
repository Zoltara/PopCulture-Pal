import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

function isValidHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Only create client if both vars are present AND the URL is a valid http/https URL.
// Guards against placeholder values that would cause createClient to throw.
if (supabaseUrl && !isValidHttpUrl(supabaseUrl)) {
  console.error(
    `[Supabase] VITE_SUPABASE_URL is set but not a valid URL: "${supabaseUrl}"\n` +
    'It must be in the format: https://<ref>.supabase.co'
  );
}

export const supabase: SupabaseClient | null =
  isValidHttpUrl(supabaseUrl) && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const isSupabaseAvailable = !!supabase;

/* ── owner identity ──────────────────────────────────────────
   This is a single-owner personal app. All rows use a fixed
   owner ID so data is never lost when localStorage is cleared. */
const OWNER_ID = 'owner';

/* ── types ───────────────────────────────────────────────────*/
export interface TrackerSettings {
  notif_enabled:   boolean;
  last_checked_at: string | null;
}

/* ── series CRUD ─────────────────────────────────────────────*/

export async function fetchSeries(): Promise<string[]> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('tracked_series')
    .select('series_name')
    .order('added_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r: { series_name: string }) => r.series_name);
}

export async function addSeries(name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('tracked_series')
    .insert({ device_id: OWNER_ID, series_name: name });

  if (error) throw error;
}

export async function removeSeries(name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('tracked_series')
    .delete()
    .eq('series_name', name);

  if (error) throw error;
}

/* ── settings ────────────────────────────────────────────────*/

export async function fetchSettings(): Promise<TrackerSettings | null> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('tracker_settings')
    .select('notif_enabled, last_checked_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error; // maybeSingle() returns null instead of throwing when no row found
  return data ?? null;
}

export async function saveSettings(settings: Partial<TrackerSettings>): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('tracker_settings')
    .upsert({
      device_id: OWNER_ID,
      updated_at: new Date().toISOString(),
      ...settings,
    }, { onConflict: 'device_id' });

  if (error) throw error;
}
