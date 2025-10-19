'use client';

import React, { useState } from 'react';
import { Search, Sparkles, Calendar, Building2, ChevronDown, ExternalLink, Loader2, AlertCircle } from 'lucide-react';

const AGENCIES = [
  { id: 'digital', name: 'デジタル庁' },
  { id: 'cabinet', name: '内閣府・内閣官房' },
  { id: 'mic', name: '総務省' },
  { id: 'meti', name: '経済産業省' },
  { id: 'mhlw', name: '厚生労働省' },
  { id: 'mext', name: '文部科学省' },
  { id: 'ppc', name: '個人情報保護委員会' },
];

interface SearchResult {
  doc_id: string;
  chunk_id: string;
  meeting: string;
  agency: string;
  date: string;
  title: string;
  snippet: string;
  score: number;
  url: string;
  page_from: number;
  page_to: number;
}

interface Summary {
  summary: string;
  sources: Array<{
    doc_url: string;
    meeting: string;
    date: string;
    pages: string;
  }>;
  cost_estimate: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export default function ModernDashboard() {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState('2025-01-01');
  const [dateTo, setDateTo] = useState('2025-12-31');
  const [selectedAgencies, setSelectedAgencies] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    
    setSearching(true);
    setError(null);
    setHasSearched(false);
    setSummary(null);
    
    try {
      // 検索API呼び出し
      const params = new URLSearchParams({
        q: query,
        from: dateFrom,
        to: dateTo,
        size: '50'
      });
      
      if (selectedAgencies.size > 0) {
        const agencyNames = Array.from(selectedAgencies).map(id => {
          const agency = AGENCIES.find(a => a.id === id);
          return agency?.name || '';
        }).filter(Boolean);
        if (agencyNames.length > 0) {
          params.append('agencies', agencyNames.join(','));
        }
      }
      
      const response = await fetch(`/api/search?${params}`);
      
      if (!response.ok) {
        throw new Error('検索に失敗しました');
      }
      
      const data = await response.json();
      setSearchResults(data.hits || []);
      setHasSearched(true);
      
      // 検索結果がある場合、自動的に要約を生成
      if (data.hits && data.hits.length > 0) {
        generateSummary(data.hits.slice(0, 3));
      }
      
    } catch (error) {
      console.error('Search error:', error);
      setError('検索中にエラーが発生しました');
      setHasSearched(true);
    } finally {
      setSearching(false);
    }
  };

  const generateSummary = async (results: SearchResult[]) => {
    setSummarizing(true);
    
    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query,
          chunks: results.map(r => ({
            meeting: r.meeting,
            agency: r.agency,
            date: r.date,
            title: r.title,
            snippet: r.snippet,
            url: r.url,
            page_from: r.page_from,
            page_to: r.page_to
          }))
        })
      });

      if (!response.ok) {
        throw new Error('要約生成に失敗しました');
      }

      const data = await response.json();
      setSummary(data);
      
    } catch (error) {
      console.error('Summary error:', error);
      setError('要約生成中にエラーが発生しました');
    } finally {
      setSummarizing(false);
    }
  };

  const toggleAgency = (id: string) => {
    const newSet = new Set(selectedAgencies);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedAgencies(newSet);
  };

  const renderMarkdown = (text: string) => {
    return text.split('\n').map((line, idx) => {
      if (line.startsWith('## ')) {
        return <h3 key={idx} className="text-lg font-bold text-gray-900 mt-6 mb-3">{line.slice(3)}</h3>;
      } else if (line.startsWith('# ')) {
        return <h2 key={idx} className="text-xl font-bold text-gray-900 mt-4 mb-3">{line.slice(2)}</h2>;
      } else if (line.startsWith('**') && line.endsWith('**')) {
        return <h2 key={idx} className="text-xl font-bold text-gray-900 mt-4 mb-3">{line.slice(2, -2)}</h2>;
      } else if (line.startsWith('- ')) {
        const parts = line.slice(2).split(/(\*\*.*?\*\*)/g);
        return (
          <li key={idx} className="ml-4 mb-2 text-gray-700">
            {parts.map((part, i) => 
              part.startsWith('**') && part.endsWith('**') 
                ? <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
                : <span key={i}>{part}</span>
            )}
          </li>
        );
      } else if (line.trim() === '') {
        return <br key={idx} />;
      }
      return <p key={idx} className="mb-2 text-gray-700">{line}</p>;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* ヘッダー */}
      <header className="border-b border-gray-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              政府IT検索
            </h1>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center gap-2 transition-colors"
          >
            フィルター
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* フィルターパネル（折りたたみ可能） */}
        {showFilters && (
          <div className="border-t border-gray-200 bg-gray-50">
            <div className="max-w-4xl mx-auto px-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">期間</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-gray-500">〜</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">省庁</label>
                  <div className="flex flex-wrap gap-2">
                    {AGENCIES.map(agency => (
                      <button
                        key={agency.id}
                        onClick={() => toggleAgency(agency.id)}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                          selectedAgencies.has(agency.id)
                            ? 'bg-blue-100 text-blue-700 border border-blue-300'
                            : 'bg-white text-gray-600 border border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        {agency.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-4xl mx-auto px-6">
        {/* 検索ボックス（未検索時は中央、検索後は上部） */}
        <div className={`transition-all duration-500 ${
          hasSearched ? 'py-6' : 'py-20 md:py-32'
        }`}>
          <div className={`transition-all duration-500 ${
            hasSearched ? '' : 'text-center'
          }`}>
            {!hasSearched && (
              <div className="mb-8">
                <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
                  政府IT会議を検索
                </h2>
                <p className="text-lg text-gray-600">
                  AI、マイナンバー、データ連携など、最新の政策情報を即座に検索
                </p>
              </div>
            )}
            
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="例: 生成AI予算、マイナンバーカード、データ連携基盤..."
                className="w-full pl-12 pr-32 py-4 text-lg border border-gray-300 rounded-xl shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              <button
                onClick={handleSearch}
                disabled={!query.trim() || searching}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-all"
              >
                {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : '検索'}
              </button>
            </div>

            {!hasSearched && (
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {['生成AI予算', 'マイナンバーカード', 'データ連携', 'サイバーセキュリティ'].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setQuery(suggestion);
                      setTimeout(handleSearch, 100);
                    }}
                    className="px-4 py-2 bg-white border border-gray-300 rounded-full text-sm text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ローディング状態 */}
        {searching && (
          <div className="py-12 text-center">
            <div className="inline-flex items-center gap-3 px-6 py-3 bg-blue-50 rounded-full">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <span className="text-blue-900 font-medium">検索中...</span>
            </div>
          </div>
        )}

        {/* エラー表示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-900">エラー</h3>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* 検索結果なし */}
        {hasSearched && !searching && searchResults.length === 0 && !error && (
          <div className="py-12 text-center">
            <div className="inline-block p-4 bg-gray-100 rounded-full mb-4">
              <Search className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">結果が見つかりませんでした</h3>
            <p className="text-gray-600">別のキーワードや期間で検索してみてください</p>
          </div>
        )}

        {/* 検索結果（要約 + ソース） */}
        {hasSearched && !searching && searchResults.length > 0 && (
          <div className="pb-12 space-y-8">
            {/* 要約セクション */}
            {summarizing && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                  <span className="text-gray-700 font-medium">AI要約を生成中...</span>
                </div>
              </div>
            )}

            {summary && !summarizing && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                  <h2 className="text-lg font-semibold text-gray-900">AI要約</h2>
                  <span className="ml-auto text-xs text-gray-500">
                    {Math.ceil((summary.cost_estimate.prompt_tokens + summary.cost_estimate.completion_tokens) / 1000 * 0.5)}円
                  </span>
                </div>
                <div className="prose prose-sm max-w-none">
                  {renderMarkdown(summary.summary)}
                </div>
              </div>
            )}

            {/* ソースセクション */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                参照元 ({searchResults.length}件)
              </h3>
              <div className="space-y-3">
                {searchResults.map((result) => (
                  <div
                    key={result.chunk_id}
                    className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h4 className="font-semibold text-gray-900 flex-1">{result.title}</h4>
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-sm"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded font-medium">
                        {result.agency}
                      </span>
                      <span className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded">
                        {result.meeting}
                      </span>
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {result.date}
                      </span>
                      <span className="text-xs text-gray-400">
                        p.{result.page_from}–{result.page_to}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{result.snippet}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}