import React, { useState } from 'react';
import { Search, Loader2, ExternalLink, Plus } from 'lucide-react';
import { findGrants } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { Grant, GrantStatus } from '../types';

interface GrantFinderProps {
  onAddGrant: (grant: Grant) => void;
}

const GrantFinder: React.FC<GrantFinderProps> = ({ onAddGrant }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; sources: any[] } | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setResult(null);
    try {
      const data = await findGrants(query);
      setResult(data);
    } catch (error) {
      alert("Failed to fetch results. Check API Key.");
    } finally {
      setLoading(false);
    }
  };

  const convertToGrant = (title: string, desc: string) => {
    const newGrant: Grant = {
      id: Date.now().toString(),
      title: title,
      funder: 'Unknown (AI Found)',
      description: desc,
      deadline: 'TBD',
      status: GrantStatus.DISCOVERED,
      matchScore: 80,
      tasks: []
    };
    onAddGrant(newGrant);
    alert('Grant added to your tracking list!');
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <header>
        <h2 className="text-2xl font-bold text-primary">Find Funding</h2>
        <p className="text-slate-500">
          Use AI to scan global databases (Horizon Europe, NKFIH, NIH) for opportunities.
        </p>
      </header>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <form onSubmit={handleSearch} className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 text-slate-400 w-5 h-5" />
            <input
              type="text"
              className="w-full pl-10 pr-4 py-3 rounded-lg border border-slate-200 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all"
              placeholder="e.g., Artificial Intelligence in Agriculture, Green Energy for Hungary..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-accent hover:bg-blue-600 text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2 disabled:opacity-70"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search Worldwide'}
          </button>
        </form>
      </div>

      <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-slate-100 shadow-sm p-6 relative">
        {!result && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Search className="w-16 h-16 mb-4 opacity-20" />
            <p>Enter a research topic to find funding opportunities.</p>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Loader2 className="w-12 h-12 mb-4 animate-spin text-accent" />
            <p>Scanning global databases & NKFIH...</p>
          </div>
        )}

        {result && (
          <div className="prose prose-slate max-w-none">
            <div className="flex justify-between items-start mb-6 border-b border-slate-100 pb-4">
              <h3 className="text-lg font-bold text-primary m-0">AI Search Results</h3>
              <button 
                onClick={() => convertToGrant(`Search Result: ${query}`, result.text.substring(0, 100) + "...")}
                className="text-sm bg-green-50 text-green-700 px-3 py-1 rounded-full hover:bg-green-100 flex items-center gap-1"
              >
                <Plus className="w-4 h-4" /> Save Search as Lead
              </button>
            </div>
            
            <ReactMarkdown
               components={{
                 a: ({node, ...props}) => <a {...props} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer" />
               }}
            >
              {result.text}
            </ReactMarkdown>

            {result.sources.length > 0 && (
              <div className="mt-8 pt-6 border-t border-slate-100">
                <h4 className="text-sm font-bold text-slate-500 uppercase mb-3">Sources & Links</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {result.sources.map((chunk, idx) => {
                     const url = chunk.web?.uri || chunk.web?.url;
                     const title = chunk.web?.title || "Source Link";
                     if(!url) return null;
                     return (
                      <a 
                        key={idx}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 hover:border-accent hover:bg-blue-50 transition-colors group"
                      >
                        <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-accent" />
                        <span className="text-sm text-slate-600 truncate group-hover:text-primary">{title}</span>
                      </a>
                     )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GrantFinder;
