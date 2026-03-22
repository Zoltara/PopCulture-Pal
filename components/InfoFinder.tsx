import React, { useState } from 'react';
import Button from './Button';
import Card from './Card';
import { lookupMediaInfo, LookupResult } from '../services/geminiService';

interface Channel {
  id: string;
  name: string;
  url: string;
  logo: string;
  brandColor: string;
}

const ISRAELI_CHANNELS: Channel[] = [
  { 
    id: 'kan11', 
    name: 'Kan 11', 
    url: 'https://www.kan.org.il/lobby/kan11/', 
    logo: 'כאן 11', 
    brandColor: 'bg-[#1C3B73]' 
  },
  { 
    id: 'keshet12', 
    name: 'Keshet 12', 
    url: 'https://www.mako.co.il/mako-vod-index', 
    logo: '12 Mako', 
    brandColor: 'bg-[#00AEEF]' 
  },
  { 
    id: 'reshet13', 
    name: 'Reshet 13', 
    url: 'https://13tv.co.il/all-shows/all-shows-list/', 
    logo: '13 רשת', 
    brandColor: 'bg-[#EE1C25]' 
  },
  { 
    id: 'yes', 
    name: 'YES', 
    url: 'https://www.yes.co.il/content/series/', 
    logo: 'yes.', 
    brandColor: 'bg-[#2D2D2D]' 
  },
  { 
    id: 'hot', 
    name: 'HOT', 
    url: 'https://www.hot.net.il/heb/tv/tvguide/', 
    logo: 'HOT', 
    brandColor: 'bg-[#E30613]' 
  },
];

const InfoFinder: React.FC = () => {
  const [mode, setMode] = useState<'streaming' | 'israeli'>('streaming');
  const [query, setQuery] = useState('');
  const [searchCurrentAiring, setSearchCurrentAiring] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  const handleSearch = async (e?: React.FormEvent, channelOverride?: Channel) => {
    if (e) e.preventDefault();
    
    // validation
    const targetChannel = channelOverride || selectedChannel;
    if (!searchCurrentAiring && !query.trim() && !targetChannel) return;

    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const data = await lookupMediaInfo(
        query, 
        mode, 
        searchCurrentAiring, 
        targetChannel ? { name: targetChannel.name, url: targetChannel.url } : undefined
      );
      setResult(data);
    } catch (err) {
      setError("Failed to fetch info. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleChannelClick = (channel: Channel) => {
    setSelectedChannel(channel);
    setSearchCurrentAiring(false);
    setQuery(''); // Clear manual query for channel scan
    handleSearch(undefined, channel);
  };

  const getStatusColor = (line: string): string | null => {
    const lowerLine = line.toLowerCase();
    
    // Check for status indicators
    if (lowerLine.includes('status:') || lowerLine.includes('coming soon') || lowerLine.includes('next episode')) {
      // New series indicators
      if (lowerLine.includes('new') || lowerLine.includes('premiered') || lowerLine.includes('just started')) {
        return 'bg-green-100 border-l-4 border-green-500 text-green-900';
      }
      // Actively running indicators
      if (lowerLine.includes('actively') || lowerLine.includes('currently airing') || lowerLine.includes('broadcasting') || lowerLine.includes('weekly')) {
        return 'bg-yellow-100 border-l-4 border-yellow-500 text-yellow-900';
      }
      // VOD indicators
      if (lowerLine.includes('vod') || lowerLine.includes('completed') || lowerLine.includes('ended') || lowerLine.includes('available')) {
        return 'bg-blue-100 border-l-4 border-blue-500 text-blue-900';
      }
    }
    return null;
  };

  const renderResult = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, lineIndex) => {
      // Remove ### from lines
      let cleanedLine = line.replace(/^###\s*/, '');
      
      const statusColor = getStatusColor(cleanedLine);
      
      // Check if this line starts a new show (numbered list like "1.", "2.", etc.)
      const isNewShow = /^\d+\.\s/.test(cleanedLine.trim());
      
      const parts = cleanedLine.split(/(\*\*.*?\*\*)/g);
      const renderedLine = parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index} className="font-black text-cartoon-blue">{part.slice(2, -2)}</strong>;
        }
        return <span key={index}>{part}</span>;
      });

      if (statusColor) {
        return (
          <div key={lineIndex} className={`${statusColor} px-3 py-2 rounded-lg mb-2 font-medium ${isNewShow && lineIndex > 0 ? 'mt-6' : ''}`}>
            {renderedLine}
          </div>
        );
      }

      // Add spacing before new numbered shows
      if (isNewShow && lineIndex > 0) {
        return (
          <React.Fragment key={lineIndex}>
            <div className="h-4"></div>
            <div>
              {renderedLine}
              {cleanedLine && <br />}
            </div>
          </React.Fragment>
        );
      }

      return (
        <div key={lineIndex}>
          {renderedLine}
          {cleanedLine && <br />}
        </div>
      );
    });
  };

  const getChannelLink = (): { url: string; label: string } | null => {
    if (!result) return null;

    const resultText = result.text.toLowerCase();
    
    // Check for channel names in the result or selected channel
    if (selectedChannel?.id === 'kan11' || resultText.includes('kan 11') || resultText.includes('כאן 11')) {
      return { url: 'https://www.kan.org.il/lobby/kan-box/', label: 'Kan Box' };
    }
    if (selectedChannel?.id === 'keshet12' || resultText.includes('keshet 12') || resultText.includes('mako') || resultText.includes('ערוץ 12')) {
      return { url: 'https://www.mako.co.il/mako-vod-index', label: 'Mako VOD' };
    }
    if (selectedChannel?.id === 'reshet13' || resultText.includes('reshet 13') || resultText.includes('רשת 13') || resultText.includes('ערוץ 13')) {
      return { url: 'https://13tv.co.il/all-shows/all-shows-list/', label: 'All Shows' };
    }
    if (selectedChannel?.id === 'yes' || resultText.includes('yes')) {
      return { url: 'https://www.yes.co.il/content/series/', label: 'YES' };
    }
    if (selectedChannel?.id === 'hot' || resultText.includes('hot')) {
      return { url: 'https://www.hot.net.il/heb/tv/channels/hotchannels/', label: 'HOT' };
    }

    return null;
  };

  return (
    <div className="max-w-2xl mx-auto w-full px-4">
      <Card title="Quick Info Finder" color="bg-cartoon-purple" className="mb-6 text-black">
        
        {/* Toggle Mode */}
        <div className="flex bg-black p-1 rounded-lg mb-6">
          <button
            onClick={() => { setMode('streaming'); setResult(null); setSearchCurrentAiring(false); setSelectedChannel(null); }}
            className={`flex-1 py-3 text-lg font-bold rounded-md transition-colors ${mode === 'streaming' ? 'bg-cartoon-yellow text-black' : 'text-white hover:text-gray-300'}`}
          >
            Streaming 📺
          </button>
          <button
            onClick={() => { setMode('israeli'); setResult(null); setSelectedChannel(null); }}
            className={`flex-1 py-3 text-lg font-bold rounded-md transition-colors ${mode === 'israeli' ? 'bg-cartoon-blue text-black' : 'text-white hover:text-gray-300'}`}
          >
            Israeli TV 🇮🇱
          </button>
        </div>

        {mode === 'israeli' && (
          <div className="mb-6">
            <h4 className="text-black font-black uppercase text-xs tracking-widest mb-3 text-center">Scan Specific Channels</h4>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
              {ISRAELI_CHANNELS.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => handleChannelClick(channel)}
                  className={`flex flex-col items-center gap-2 p-2 rounded-xl border-2 transition-all transform hover:scale-105 active:scale-95 ${selectedChannel?.id === channel.id ? 'border-cartoon-yellow bg-cartoon-yellow/20 shadow-hard-sm' : 'border-black bg-white shadow-hard-sm'}`}
                >
                  <div className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-lg text-white font-black text-[10px] md:text-xs text-center leading-none px-1 ${channel.brandColor} border-2 border-black`}>
                    {channel.logo}
                  </div>
                  <span className="text-[10px] md:text-xs font-black text-black text-center">{channel.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSearch} className="flex flex-col gap-4">
          <div>
            <label className="block font-bold mb-2 text-lg text-black">
              {mode === 'streaming' ? 'Movie / Series Name' : 'Specific Series Search'}
            </label>
            <input 
              type="text" 
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value) setSelectedChannel(null); // Clear selected channel if typing manually
              }}
              placeholder={mode === 'streaming' ? "e.g. Breaking Bad" : "e.g. Fauda"}
              disabled={loading}
              className={`w-full border-2 border-black rounded-xl p-4 text-xl text-white placeholder-gray-400 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none focus:ring-4 focus:ring-yellow-400 bg-black`}
            />
          </div>

          {mode === 'israeli' && (
            <div className="bg-white/50 p-3 rounded-lg border-2 border-black/10">
              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={searchCurrentAiring}
                  onChange={(e) => {
                    setSearchCurrentAiring(e.target.checked);
                    if (e.target.checked) setSelectedChannel(null);
                  }}
                  className="w-6 h-6 border-2 border-black rounded text-cartoon-blue focus:ring-cartoon-yellow cursor-pointer"
                />
                <span className="font-bold text-black text-lg leading-tight">
                  Discover trending across all channels <br/>
                  <span className="text-xs font-normal opacity-75">(Gemini Search Grounding)</span>
                </span>
              </label>
            </div>
          )}

          <Button type="submit" variant="secondary" disabled={loading || (!searchCurrentAiring && !query.trim() && !selectedChannel)} className="mt-2 w-full justify-center text-xl py-4">
            {loading ? (
              <span className="flex items-center justify-center gap-3">
                <span className="relative flex items-center justify-center w-6 h-6 shrink-0">
                  <span className="absolute inset-0 rounded-full border-[3px] border-black border-t-transparent animate-spin" />
                  <span className="text-sm">🔎</span>
                </span>
                <span className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-2 h-2 rounded-full bg-black animate-bounce inline-block"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
                <span>{selectedChannel ? `Scanning ${selectedChannel.name}` : 'Scanning'}</span>
              </span>
            ) : 'Find Info 🔎'}
          </Button>
        </form>
      </Card>

      {/* Results Area */}
      {result && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Card color="bg-white" className="border-2 border-black shadow-hard">
            <h3 className="font-black text-xl mb-3 text-cartoon-dark border-b-2 border-gray-200 pb-2">
              {selectedChannel ? `Scanning ${selectedChannel.name}...` : 'Search Result:'}
            </h3>
            
            {/* Status Color Code Legend */}
            {mode === 'israeli' && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p className="text-xs font-bold uppercase text-gray-600 mb-2">Status Color Code:</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="bg-green-100 border-l-4 border-green-500 text-green-900 px-2 py-1 rounded font-semibold">🟢 New Series</span>
                  <span className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-900 px-2 py-1 rounded font-semibold">🟡 Actively Running</span>
                  <span className="bg-blue-100 border-l-4 border-blue-500 text-blue-900 px-2 py-1 rounded font-semibold">🔵 VOD</span>
                </div>
              </div>
            )}

            <div className="text-md font-medium leading-relaxed text-black mb-4">
              {renderResult(result.text)}
            </div>

            {/* Channel-Specific Link */}
            {mode === 'israeli' && getChannelLink() && (
              <div className="mt-4 mb-4">
                <a
                  href={getChannelLink()!.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-cartoon-purple hover:bg-cartoon-purple/80 text-white font-bold py-3 px-6 rounded-xl border-2 border-black shadow-hard hover:shadow-none transition-all"
                >
                  <span>📺</span>
                  <span>View More on {getChannelLink()!.label}</span>
                  <span>→</span>
                </a>
              </div>
            )}

            {result.sources.length > 0 && (
              <div className="mt-4 pt-4 border-t-2 border-dashed border-gray-200">
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
          </Card>
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

export default InfoFinder;