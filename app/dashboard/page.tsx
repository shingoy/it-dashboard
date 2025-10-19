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
        return <h3 key={idx} style={{ fontSize: '1.125rem', fontWeight: 'bold', marginTop: '1.5rem', marginBottom: '0.75rem' }}>{line.slice(3)}</h3>;
      } else if (line.startsWith('# ')) {
        return <h2 key={idx} style={{ fontSize: '1.25rem', fontWeight: 'bold', marginTop: '1rem', marginBottom: '0.75rem' }}>{line.slice(2)}</h2>;
      } else if (line.startsWith('**') && line.endsWith('**')) {
        return <h2 key={idx} style={{ fontSize: '1.25rem', fontWeight: 'bold', marginTop: '1rem', marginBottom: '0.75rem' }}>{line.slice(2, -2)}</h2>;
      } else if (line.startsWith('- ')) {
        const parts = line.slice(2).split(/(\*\*.*?\*\*)/g);
        return (
          <li key={idx} style={{ marginLeft: '1rem', marginBottom: '0.5rem' }}>
            {parts.map((part, i) => 
              part.startsWith('**') && part.endsWith('**') 
                ? <strong key={i}>{part.slice(2, -2)}</strong>
                : <span key={i}>{part}</span>
            )}
          </li>
        );
      } else if (line.trim() === '') {
        return <br key={idx} />;
      }
      return <p key={idx} style={{ marginBottom: '0.5rem' }}>{line}</p>;
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(to bottom, #f9fafb, white)' }}>
      {/* ヘッダー */}
      <header style={{ 
        borderBottom: '1px solid #e5e7eb', 
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(8px)',
        position: 'sticky',
        top: 0,
        zIndex: 10
      }}>
        <div style={{ maxWidth: '56rem', margin: '0 auto', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ 
              width: '2rem', 
              height: '2rem', 
              background: 'linear-gradient(to bottom right, #3b82f6, #9333ea)',
              borderRadius: '0.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Sparkles style={{ width: '1.25rem', height: '1.25rem', color: 'white' }} />
            </div>
            <h1 style={{ 
              fontSize: '1.25rem', 
              fontWeight: 'bold',
              background: 'linear-gradient(to right, #2563eb, #9333ea)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              政府IT検索
            </h1>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{ 
              padding: '0.5rem 1rem', 
              fontSize: '0.875rem', 
              color: '#4b5563',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              border: 'none',
              background: 'none',
              cursor: 'pointer'
            }}
          >
            フィルター
            <ChevronDown style={{ 
              width: '1rem', 
              height: '1rem',
              transform: showFilters ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s'
            }} />
          </button>
        </div>

        {showFilters && (
          <div style={{ borderTop: '1px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
            <div style={{ maxWidth: '56rem', margin: '0 auto', padding: '1rem 1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>期間</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.875rem' }}
                    />
                    <span>〜</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.875rem' }}
                    />
                  </div>
                </div>
                
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>省庁</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {AGENCIES.map(agency => (
                      <button
                        key={agency.id}
                        onClick={() => toggleAgency(agency.id)}
                        style={{
                          padding: '0.25rem 0.75rem',
                          borderRadius: '9999px',
                          fontSize: '0.875rem',
                          border: '1px solid',
                          borderColor: selectedAgencies.has(agency.id) ? '#93c5fd' : '#d1d5db',
                          backgroundColor: selectedAgencies.has(agency.id) ? '#dbeafe' : 'white',
                          color: selectedAgencies.has(agency.id) ? '#1e40af' : '#4b5563',
                          cursor: 'pointer'
                        }}
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
      <main style={{ maxWidth: '56rem', margin: '0 auto', padding: '0 1.5rem' }}>
        <div style={{ 
          padding: hasSearched ? '1.5rem 0' : '5rem 0',
          transition: 'padding 0.5s'
        }}>
          <div style={{ textAlign: hasSearched ? 'left' : 'center' }}>
            {!hasSearched && (
              <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', fontWeight: 'bold', marginBottom: '1rem' }}>
                  政府IT会議を検索
                </h2>
                <p style={{ fontSize: '1.125rem', color: '#6b7280' }}>
                  AI、マイナンバー、データ連携など、最新の政策情報を即座に検索
                </p>
              </div>
            )}
            
            <div style={{ position: 'relative' }}>
              <Search style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', width: '1.25rem', height: '1.25rem' }} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="例: 生成AI予算、マイナンバーカード、データ連携基盤..."
                style={{
                  width: '100%',
                  paddingLeft: '3rem',
                  paddingRight: '8rem',
                  paddingTop: '1rem',
                  paddingBottom: '1rem',
                  fontSize: '1.125rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.75rem',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  outline: 'none'
                }}
                autoFocus
              />
              <button
                onClick={handleSearch}
                disabled={!query.trim() || searching}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  padding: '0.5rem 1.5rem',
                  background: 'linear-gradient(to right, #2563eb, #9333ea)',
                  color: 'white',
                  borderRadius: '0.5rem',
                  border: 'none',
                  fontWeight: '500',
                  cursor: !query.trim() || searching ? 'not-allowed' : 'pointer',
                  opacity: !query.trim() || searching ? 0.5 : 1
                }}
              >
                {searching ? <Loader2 style={{ width: '1.25rem', height: '1.25rem', animation: 'spin 1s linear infinite' }} /> : '検索'}
              </button>
            </div>

            {!hasSearched && (
              <div style={{ marginTop: '1.5rem', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.5rem' }}>
                {['生成AI予算', 'マイナンバーカード', 'データ連携', 'サイバーセキュリティ'].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => {
                      setQuery(suggestion);
                      setTimeout(handleSearch, 100);
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: 'white',
                      border: '1px solid #d1d5db',
                      borderRadius: '9999px',
                      fontSize: '0.875rem',
                      cursor: 'pointer'
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {searching && (
          <div style={{ padding: '3rem 0', textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1.5rem', backgroundColor: '#eff6ff', borderRadius: '9999px' }}>
              <Loader2 style={{ width: '1.25rem', height: '1.25rem', color: '#2563eb', animation: 'spin 1s linear infinite' }} />
              <span style={{ color: '#1e3a8a', fontWeight: '500' }}>検索中...</span>
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', display: 'flex', alignItems: 'start', gap: '0.75rem' }}>
            <AlertCircle style={{ width: '1.25rem', height: '1.25rem', color: '#dc2626', marginTop: '0.125rem' }} />
            <div>
              <h3 style={{ fontWeight: '600', color: '#7f1d1d' }}>エラー</h3>
              <p style={{ fontSize: '0.875rem', color: '#991b1b' }}>{error}</p>
            </div>
          </div>
        )}

        {hasSearched && !searching && searchResults.length === 0 && !error && (
          <div style={{ padding: '3rem 0', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', padding: '1rem', backgroundColor: '#f3f4f6', borderRadius: '9999px', marginBottom: '1rem' }}>
              <Search style={{ width: '2rem', height: '2rem', color: '#9ca3af' }} />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: '600', marginBottom: '0.5rem' }}>結果が見つかりませんでした</h3>
            <p style={{ color: '#6b7280' }}>別のキーワードや期間で検索してみてください</p>
          </div>
        )}

        {hasSearched && !searching && searchResults.length > 0 && (
          <div style={{ paddingBottom: '3rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {summarizing && (
              <div style={{ backgroundColor: 'white', borderRadius: '0.75rem', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Loader2 style={{ width: '1.25rem', height: '1.25rem', color: '#9333ea', animation: 'spin 1s linear infinite' }} />
                  <span style={{ fontWeight: '500' }}>AI要約を生成中...</span>
                </div>
              </div>
            )}

            {summary && !summarizing && (
              <div style={{ backgroundColor: 'white', borderRadius: '0.75rem', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <Sparkles style={{ width: '1.25rem', height: '1.25rem', color: '#9333ea' }} />
                  <h2 style={{ fontSize: '1.125rem', fontWeight: '600' }}>AI要約</h2>
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#6b7280' }}>
                    {Math.ceil((summary.cost_estimate.prompt_tokens + summary.cost_estimate.completion_tokens) / 1000 * 0.5)}円
                  </span>
                </div>
                <div>{renderMarkdown(summary.summary)}</div>
              </div>
            )}

            <div>
              <h3 style={{ fontSize: '0.875rem', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Building2 style={{ width: '1rem', height: '1rem' }} />
                参照元 ({searchResults.length}件)
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {searchResults.map((result) => (
                  <div
                    key={result.chunk_id}
                    style={{ backgroundColor: 'white', borderRadius: '0.5rem', border: '1px solid #e5e7eb', padding: '1rem', transition: 'box-shadow 0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
                  >
                    <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <h4 style={{ fontWeight: '600', flex: 1 }}>{result.title}</h4>
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#2563eb', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', textDecoration: 'none' }}
                      >
                        <ExternalLink style={{ width: '1rem', height: '1rem' }} />
                      </a>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ padding: '0.125rem 0.5rem', backgroundColor: '#eff6ff', color: '#1e40af', fontSize: '0.75rem', borderRadius: '0.25rem', fontWeight: '500' }}>
                        {result.agency}
                      </span>
                      <span style={{ padding: '0.125rem 0.5rem', backgroundColor: '#f0fdf4', color: '#15803d', fontSize: '0.75rem', borderRadius: '0.25rem' }}>
                        {result.meeting}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Calendar style={{ width: '0.75rem', height: '0.75rem' }} />
                        {result.date}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                        p.{result.page_from}–{result.page_to}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>{result.snippet}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}