import React, { useState } from 'react';
import { Grant, KnowledgeAsset } from '../types';
import { FileText, Link as LinkIcon, Download, Search, Building2, ExternalLink, Scale, User, File } from 'lucide-react';
import { Link } from 'react-router-dom';

interface SourcesProps {
  grants: Grant[];
}

interface EnrichedAsset extends KnowledgeAsset {
  grantTitle: string;
  grantId: string;
}

const Sources: React.FC<SourcesProps> = ({ grants }) => {
  const [searchTerm, setSearchTerm] = useState('');

  // 1. Extract and Enrich Assets
  // We flatten the data structure to get a list of all assets with their parent grant info.
  const allAssets: EnrichedAsset[] = grants.flatMap(grant => 
    (grant.knowledgeBase || []).map(asset => ({
      ...asset,
      grantTitle: grant.title,
      grantId: grant.id
    }))
  );

  // 2. Filter Assets
  const filteredAssets = allAssets.filter(asset => 
    asset.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    asset.grantTitle.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // 3. Group by Funder (Company)
  // We need to look up the Funder based on the grantId of the asset
  const groupedAssets = filteredAssets.reduce((acc, asset) => {
    const parentGrant = grants.find(g => g.id === asset.grantId);
    const funder = parentGrant?.funder || 'Unknown Funder';
    
    if (!acc[funder]) {
      acc[funder] = [];
    }
    acc[funder].push(asset);
    return acc;
  }, {} as Record<string, EnrichedAsset[]>);

  // Helper for Asset Icon
  const getAssetIcon = (type: string) => {
    switch(type) {
      case 'link': return <LinkIcon className="w-5 h-5 text-purple-500" />;
      case 'cv': return <User className="w-5 h-5 text-orange-500" />;
      case 'review': return <Scale className="w-5 h-5 text-indigo-500" />;
      default: return <FileText className="w-5 h-5 text-blue-500" />;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header>
        <h2 className="text-2xl font-bold text-primary flex items-center gap-2">
          <Building2 className="w-6 h-6 text-accent" />
          Sources & Assets
        </h2>
        <p className="text-slate-500">
          Centralized repository of all documents, links, and reviews used in your applications, grouped by Funding Body.
        </p>
      </header>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm sticky top-0 z-10">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search for documents, articles, CVs, or grant titles..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-8">
        {Object.keys(groupedAssets).length === 0 ? (
           <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-200">
             <File className="w-12 h-12 text-slate-300 mx-auto mb-3" />
             <p className="text-slate-500">No assets found matching your criteria.</p>
           </div>
        ) : (
          Object.entries(groupedAssets).sort().map(([funder, assets]) => (
            <div key={funder} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              {/* Funder Header */}
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                      <Building2 className="w-5 h-5 text-slate-600" />
                   </div>
                   <div>
                     <h3 className="font-bold text-slate-800 text-lg">{funder}</h3>
                     <p className="text-xs text-slate-500 uppercase tracking-wide">{assets.length} items</p>
                   </div>
                </div>
              </div>

              {/* Assets List */}
              <div className="divide-y divide-slate-100">
                {assets.map(asset => (
                  <div key={asset.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                    <div className="flex items-center gap-4 overflow-hidden">
                       <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                         asset.type === 'link' ? 'bg-purple-50' : 
                         asset.type === 'cv' ? 'bg-orange-50' : 
                         asset.type === 'review' ? 'bg-indigo-50' : 'bg-blue-50'
                       }`}>
                         {getAssetIcon(asset.type)}
                       </div>
                       
                       <div className="min-w-0">
                         <div className="flex items-center gap-2">
                           <a 
                             href={asset.url}
                             target="_blank"
                             rel="noreferrer"
                             className="font-semibold text-slate-700 hover:text-accent truncate"
                           >
                             {asset.name}
                           </a>
                           <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              asset.type === 'review' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
                           }`}>
                             {asset.type}
                           </span>
                         </div>
                         <div className="flex items-center gap-2 text-sm text-slate-500">
                            <span className="flex items-center gap-1">
                               Related to: 
                               <Link to={`/grant/${asset.grantId}`} className="text-accent hover:underline flex items-center gap-1 ml-1 font-medium truncate max-w-[200px] md:max-w-md">
                                  {asset.grantTitle} <ExternalLink className="w-3 h-3" />
                               </Link>
                            </span>
                            <span className="text-slate-300">•</span>
                            <span>{asset.addedAt}</span>
                            {asset.size && (
                              <>
                                <span className="text-slate-300">•</span>
                                <span>{asset.size}</span>
                              </>
                            )}
                         </div>
                       </div>
                    </div>

                    <a 
                      href={asset.url}
                      target="_blank" 
                      rel="noreferrer"
                      className="p-2 text-slate-300 hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Open Resource"
                    >
                      {asset.type === 'link' ? <ExternalLink className="w-5 h-5" /> : <Download className="w-5 h-5" />}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Sources;
