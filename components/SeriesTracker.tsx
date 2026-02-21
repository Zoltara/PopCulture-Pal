import React, { useState, useEffect, useRef, useCallback } from 'react';
import Button from './Button';
import Card from './Card';
import { checkNewEpisodes, EpisodeStatusResult } from '../services/geminiService';
import {
  fetchSeries, addSeries, removeSeries,
  fetchSettings, saveSettings,
  isSupabaseAvailable,
} from '../services/supabaseClient';

const STORAGE_KEY        = 'popculture-pal-tracked-series';  // local cache only
const LAST_CHECK_KEY     = 'popculture-pal-last-check';
const NOTIF_ENABLED_KEY  = 'popculture-pal-notif-enabled';

type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

/* ── helpers ──────────────────────────────────────────────── */

function msUntilNextSunday(): number {
  const now  = new Date();
  const day  = now.getDay(); // 0 = Sunday
  const daysUntil = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(10, 0, 0, 0);
  return next.getTime() - now.getTime();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function nextSundayLabel(): string {
  const now = new Date();
  const day = now.getDay();
  const daysUntil = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(10, 0, 0, 0);
  return next.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' at 10:00 AM';
}

function sendBrowserNotification(title: string, body: string) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/icons/icon-192.png' });
  }
}

/** Parse Gemini plain text into per-series sections */
function parseResultSections(text: string): { title: string; body: string }[] {
  const sections: { title: string; body: string[] }[] = [];
  for (const line of text.split('\n')) {
    const titleMatch = line.trim().match(/^\*\*(.+?)\*\*\s*$/);
    if (titleMatch) {
      sections.push({ title: titleMatch[1], body: [] });
    } else if (sections.length > 0) {
      sections[sections.length - 1].body.push(line);
    }
  }
  return sections.map(s => ({ title: s.title, body: s.body.join('\n').trim() }));
}

function getStatusMeta(body: string): { color: string; badge: string; isGoodNews: boolean } {
  if (body.includes('✅')) return { color: 'border-green-500 bg-green-50',    badge: '✅ New Episodes',  isGoodNews: true  };
  if (body.includes('🔜')) return { color: 'border-blue-400 bg-blue-50',     badge: '🔜 New Season',    isGoodNews: true  };
  if (body.includes('🎬')) return { color: 'border-blue-400 bg-blue-50',     badge: '🎬 In Production', isGoodNews: true  };
  if (body.includes('⏳')) return { color: 'border-yellow-400 bg-yellow-50', badge: '⏳ Pending',        isGoodNews: false };
  if (body.includes('❌')) return { color: 'border-red-400 bg-red-50',       badge: '❌ Ended',          isGoodNews: false };
  return                          { color: 'border-gray-300 bg-white',        badge: '❓ Unknown',        isGoodNews: false };
}

/* ── component ────────────────────────────────────────────── */

const SeriesTracker: React.FC = () => {
  const [seriesList, setSeriesList] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  });
  const [inputValue,   setInputValue]   = useState('');
  const [result,       setResult]       = useState<EpisodeStatusResult | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [dbLoading,    setDbLoading]    = useState(true);  // initial cloud sync
  const [syncError,    setSyncError]    = useState(false); // cloud unreachable
  const [lastChecked,  setLastChecked]  = useState<string | null>(
    () => localStorage.getItem(LAST_CHECK_KEY)
  );
  const [notifEnabled, setNotifEnabled] = useState<boolean>(
    () => localStorage.getItem(NOTIF_ENABLED_KEY) === 'true'
  );
  const [notifPermission, setNotifPermission] = useState<NotifPermission>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission as NotifPermission;
  });

  const weeklyTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weeklyIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── initial load from Supabase ─────────────────────────── */
  useEffect(() => {
    if (!isSupabaseAvailable) {
      setDbLoading(false);
      return;
    }
    (async () => {
      try {
        const [cloud, settings] = await Promise.all([fetchSeries(), fetchSettings()]);

        // Merge: cloud is source of truth; also update localStorage cache
        setSeriesList(cloud);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud));

        if (settings) {
          setNotifEnabled(settings.notif_enabled);
          localStorage.setItem(NOTIF_ENABLED_KEY, String(settings.notif_enabled));
          if (settings.last_checked_at) {
            setLastChecked(settings.last_checked_at);
            localStorage.setItem(LAST_CHECK_KEY, settings.last_checked_at);
          }
        }
      } catch {
        setSyncError(true); // Fall back silently to localStorage data already in state
      } finally {
        setDbLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── auto-check runner ──────────────────────────────────── */
  const runAutoCheck = useCallback(async (list: string[]) => {
    if (list.length === 0) return;
    try {
      const data = await checkNewEpisodes(list);
      setResult(data);
      const now = new Date().toISOString();
      setLastChecked(now);
      localStorage.setItem(LAST_CHECK_KEY, now);
      try { await saveSettings({ last_checked_at: now }); } catch { /* noop */ }

      const sections  = parseResultSections(data.text);
      const goodNews  = sections.filter(s => getStatusMeta(s.body).isGoodNews);
      if (goodNews.length > 0) {
        sendBrowserNotification(
          '📺 PopCulture Pal – Weekly Update',
          `${goodNews.length} series have news: ${goodNews.map(s => s.title).join(', ')}`
        );
        goodNews.forEach(s => {
          const meta       = getStatusMeta(s.body);
          const statusLine = s.body.split('\n').find(l => l.startsWith('Status:')) || meta.badge;
          sendBrowserNotification(s.title, statusLine.replace('Status:', '').trim());
        });
      } else {
        sendBrowserNotification('📺 PopCulture Pal – Weekly Update', 'No new episodes or seasons this week.');
      }
    } catch {
      sendBrowserNotification('📺 PopCulture Pal', 'Weekly check failed. Open the app to retry.');
    }
  }, []);

  /* ── schedule weekly check every Sunday 10 AM ──────────── */
  const scheduleWeekly = useCallback((list: string[]) => {
    if (weeklyTimerRef.current)    clearTimeout(weeklyTimerRef.current);
    if (weeklyIntervalRef.current) clearInterval(weeklyIntervalRef.current);
    const ms = msUntilNextSunday();
    weeklyTimerRef.current = setTimeout(() => {
      runAutoCheck(list);
      weeklyIntervalRef.current = setInterval(() => runAutoCheck(list), 7 * 24 * 60 * 60 * 1000);
    }, ms);
  }, [runAutoCheck]);

  useEffect(() => {
    localStorage.setItem(NOTIF_ENABLED_KEY, String(notifEnabled));
    if (notifEnabled && notifPermission === 'granted') {
      scheduleWeekly(seriesList);
    } else {
      if (weeklyTimerRef.current)    clearTimeout(weeklyTimerRef.current);
      if (weeklyIntervalRef.current) clearInterval(weeklyIntervalRef.current);
    }
    return () => {
      if (weeklyTimerRef.current)    clearTimeout(weeklyTimerRef.current);
      if (weeklyIntervalRef.current) clearInterval(weeklyIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifEnabled, notifPermission]);

  /* ── actions ────────────────────────────────────────────── */
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || seriesList.includes(trimmed)) return;
    // Optimistic update
    const next = [...seriesList, trimmed];
    setSeriesList(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setInputValue('');
    try { await addSeries(trimmed); } catch { /* already saved in localStorage */ }
  };

  const handleRemove = async (name: string) => {
    const next = seriesList.filter(s => s !== name);
    setSeriesList(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    try { await removeSeries(name); } catch { /* already removed locally */ }
  };

  const handleCheck = async () => {
    if (seriesList.length === 0) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const data = await checkNewEpisodes(seriesList);
      setResult(data);
      const now = new Date().toISOString();
      setLastChecked(now);
      localStorage.setItem(LAST_CHECK_KEY, now);
      try { await saveSettings({ last_checked_at: now }); } catch { /* localStorage already updated */ }
    } catch {
      setError('Failed to check episode status. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleNotifications = async () => {
    if (notifPermission === 'unsupported') return;
    const next = !notifEnabled;
    if (next && notifPermission !== 'granted') {
      const res = await Notification.requestPermission();
      setNotifPermission(res as NotifPermission);
      if (res !== 'granted') return;
    }
    setNotifEnabled(next);
    localStorage.setItem(NOTIF_ENABLED_KEY, String(next));
    try { await saveSettings({ notif_enabled: next }); } catch { /* localStorage already updated */ }
  };

  /* ── render helper ──────────────────────────────────────── */
  const renderText = (text: string) =>
    text.split(/(\*\*.*?\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i} className="font-black text-cartoon-blue">{part.slice(2, -2)}</strong>
        : <span key={i}>{part}</span>
    );

  const sections = result ? parseResultSections(result.text) : [];

  /* ── JSX ────────────────────────────────────────────────── */
  return (
    <div className="max-w-2xl mx-auto w-full px-4">
      <Card title="Series Episode Tracker" color="bg-cartoon-green" className="mb-6 text-black">

        {/* Cloud sync status */}
        {dbLoading && (
          <div className="flex items-center gap-2 mb-4 text-xs font-bold text-black/50">
            <span className="w-3 h-3 rounded-full border-2 border-black/40 border-t-transparent animate-spin inline-block" />
            Syncing with cloud...
          </div>
        )}
        {!dbLoading && !isSupabaseAvailable && (
          <div className="flex items-center gap-2 mb-4 bg-yellow-50 border border-yellow-400 rounded-lg px-3 py-2 text-xs font-bold text-yellow-800">
            ⚠️ Supabase not configured — check that <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are set correctly in Vercel.
          </div>
        )}
        {!dbLoading && isSupabaseAvailable && syncError && (
          <div className="flex items-center gap-2 mb-4 bg-yellow-50 border border-yellow-400 rounded-lg px-3 py-2 text-xs font-bold text-yellow-800">
            ⚠️ Cloud sync failed — using local data.
          </div>
        )}
        {!dbLoading && !syncError && (
          <div className="flex items-center gap-1 mb-4 text-[10px] font-bold text-black/40">
            <span>☁️</span> Synced to cloud
          </div>
        )}

        {/* Add series input */}
        <form onSubmit={handleAdd} className="flex gap-2 mb-5">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="e.g. Severance"
            className="flex-1 border-2 border-black rounded-xl p-3 text-lg text-white placeholder-gray-400 bg-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-4 focus:ring-yellow-400"
          />
          <Button type="submit" variant="primary" disabled={!inputValue.trim()} className="px-5 text-lg font-black">
            + Add
          </Button>
        </form>

        {/* Series pills */}
        {seriesList.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-black/20 rounded-xl mb-5">
            <p className="text-black/50 font-bold text-lg">Add series above to start tracking</p>
            <p className="text-black/30 text-sm mt-1">e.g. Succession, The Bear, Severance</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 mb-5">
            {seriesList.map(name => (
              <div key={name} className="flex items-center gap-1 bg-white border-2 border-black rounded-full px-3 py-1 shadow-hard-sm text-sm font-bold">
                <span className="text-black">{name}</span>
                <button
                  onClick={() => handleRemove(name)}
                  className="text-black/40 hover:text-red-500 font-black text-base leading-none ml-1 transition-colors"
                  aria-label={`Remove ${name}`}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* Check button */}
        <Button
          onClick={handleCheck}
          disabled={loading || seriesList.length === 0}
          variant="secondary"
          className="w-full justify-center text-xl py-4 mb-4"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <span className="relative flex items-center justify-center w-6 h-6 shrink-0">
                <span className="absolute inset-0 rounded-full border-[3px] border-black border-t-transparent animate-spin" />
                <span className="text-sm">📺</span>
              </span>
              <span className="flex items-center gap-1">
                {[0, 1, 2].map(i => (
                  <span key={i} className="w-2 h-2 rounded-full bg-black animate-bounce inline-block" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              <span>Checking {seriesList.length} series...</span>
            </span>
          ) : `🔔 Check for New Episodes (${seriesList.length})`}
        </Button>

        {/* ── Weekly Notifications toggle ── */}
        <div className={`rounded-xl border-2 p-3 transition-colors ${notifEnabled && notifPermission === 'granted' ? 'border-green-500 bg-green-50' : 'border-black/15 bg-white/40'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-black text-black text-sm">🗓️ Weekly Sunday Check</p>
              {notifPermission === 'unsupported' ? (
                <p className="text-xs text-red-500 font-bold mt-0.5">Notifications not supported in this browser</p>
              ) : notifPermission === 'denied' ? (
                <p className="text-xs text-red-500 font-bold mt-0.5">Notifications blocked — allow them in browser settings</p>
              ) : notifEnabled && notifPermission === 'granted' ? (
                <p className="text-xs text-green-700 font-bold mt-0.5">Next check: {nextSundayLabel()}</p>
              ) : (
                <p className="text-xs text-black/50 font-bold mt-0.5">Get notified every Sunday when episodes drop</p>
              )}
              {lastChecked && (
                <p className="text-[10px] text-black/40 font-bold mt-0.5">Last checked: {formatDate(lastChecked)}</p>
              )}
            </div>
            {/* toggle switch */}
            <button
              onClick={handleToggleNotifications}
              disabled={notifPermission === 'unsupported' || notifPermission === 'denied'}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-black transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${notifEnabled && notifPermission === 'granted' ? 'bg-cartoon-green' : 'bg-gray-300'}`}
              aria-label="Toggle weekly notifications"
            >
              <span className={`inline-block h-5 w-5 rounded-full bg-white border-2 border-black shadow transition-transform ${notifEnabled && notifPermission === 'granted' ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
            </button>
          </div>
        </div>
      </Card>

      {/* ── Results ── */}
      {sections.length > 0 && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-3">
          <div className="bg-cartoon-dark text-white px-4 py-2 rounded-xl border-2 border-black shadow-hard font-black text-center uppercase tracking-widest text-sm">
            Episode Status Report
          </div>

          {sections.map((sec, i) => {
            const meta = getStatusMeta(sec.body);
            return (
              <div key={i} className="rounded-xl border-2 border-black shadow-hard overflow-hidden">
                {/* header */}
                <div className={`flex items-center justify-between px-4 py-2 border-b-2 border-black ${meta.color}`}>
                  <h3 className="font-black text-base text-black">{sec.title || '—'}</h3>
                  <span className="text-xs font-black px-2 py-0.5 rounded-full border-2 border-black bg-white/70 shrink-0 ml-2">{meta.badge}</span>
                </div>
                {/* body */}
                <div className={`px-4 py-3 ${meta.color}`}>
                  <div className="text-sm font-medium text-black leading-relaxed whitespace-pre-wrap">
                    {renderText(sec.body)}
                  </div>
                </div>
              </div>
            );
          })}

          {result && result.sources.length > 0 && (
            <div className="pt-1">
              <p className="text-[10px] font-black uppercase text-gray-500 mb-2 tracking-widest">Sources:</p>
              <div className="flex flex-wrap gap-2">
                {result.sources.map((source, i) => (
                  <a
                    key={i}
                    href={source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs bg-cartoon-blue/10 text-cartoon-blue hover:bg-cartoon-blue hover:text-white border border-cartoon-blue px-2 py-1 rounded-full font-bold transition-colors truncate max-w-[200px]"
                  >
                    🔗 {source.title || 'Source'}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <Card color="bg-red-100" className="mt-4 border-red-500">
          <p className="text-red-800 font-bold text-lg">{error}</p>
        </Card>
      )}
    </div>
  );
};

export default SeriesTracker;
