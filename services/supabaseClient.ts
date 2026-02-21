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
export const supabase: SupabaseClient | null =
  isValidHttpUrl(supabaseUrl) && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const isSupabaseAvailable = !!supabase;

/* ── device identity ─────────────────────────────────────────
   We don't require users to sign up. Instead we generate a
   random UUID once per device and persist it in localStorage.
   This UUID is used as the row identifier in Supabase.        */
const DEVICE_ID_KEY = 'popculture-pal-device-id';

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

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
    .eq('device_id', getDeviceId())
    .order('added_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r: { series_name: string }) => r.series_name);
}

export async function addSeries(name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('tracked_series')
    .insert({ device_id: getDeviceId(), series_name: name });

  if (error) throw error;
}

export async function removeSeries(name: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('tracked_series')
    .delete()
    .eq('device_id', getDeviceId())
    .eq('series_name', name);

  if (error) throw error;
}

/* ── settings ────────────────────────────────────────────────*/

export async function fetchSettings(): Promise<TrackerSettings | null> {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('tracker_settings')
    .select('notif_enabled, last_checked_at')
    .eq('device_id', getDeviceId())
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = row not found
  return data ?? null;
}

export async function saveSettings(settings: Partial<TrackerSettings>): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase
    .from('tracker_settings')
    .upsert({
      device_id: getDeviceId(),
      updated_at: new Date().toISOString(),
      ...settings,
    }, { onConflict: 'device_id' });

  if (error) throw error;
}
