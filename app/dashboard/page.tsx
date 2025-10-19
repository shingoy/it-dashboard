'use client';

import React, { useState, useMemo } from 'react';
import { Search, Calendar, Building2, FileText, TrendingUp, Loader2, Check, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

// 省庁リスト
const AGENCIES = [
  { id: 'digital', name: 'デジタル庁' },
  { id: 'cabinet', name: '内閣府・内閣官房' },
  { id: 'mic', name: '総務省' },
  { id: 'meti', name: '経済産業省' },
  { id: 'mhlw', name: '厚生労働省' },
  { id: 'mext', name: '文部科学省' },
  { id: 'ppc', name: '個人情報保護委員会' },
];

// 会議リスト
const MEETINGS: Record<string, string[]> = {
  digital: [
    'デジタル社会推進会議',
    'データ戦略推進ワーキンググループ',
    'マイナンバー制度改善WG',
    'デジタル臨時行政調査会',
    'ベース・レジストリ',
    'ガバメントクラウド',
  ],
  cabinet: [
    'AI戦略会議',
    'IT総合戦略本部',
    'サイバーセキュリティ戦略本部',
  ],
  mic: ['クラウドサービス関連会議', 'デジタル・ガバメント推進'],
  meti: ['DX推進関連審議会'],
  mhlw: ['医療DX推進本部'],
  mext: ['教育データ利活用（GIGAスクール）'],
  ppc: ['個人情報保護委員会会議'],
};

export default function GovITDashboard() {
  const [query, setQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('2025-01-01');
  const [dateTo, setDateTo] = useState('2025-12-31');
  const [selectedAgencies, setSelectedAgencies] = useState<Set<string>>(new Set());
  const [selectedMeetings, setSelectedMeetings] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [summaryMode, setSummaryMode] = useState('auto');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const toast = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const toggleAgency = (agencyId: string) => {
    const newSet = new Set(selectedAgencies);
    if (newSet.has(agencyId)) {
      newSet.delete(agencyId);
      const agencyMeetings = MEETINGS[agencyId] || [];
      agencyMeetings.forEach(m => selectedMeetings.delete(m));
    } else {
      newSet.add(agencyId);
    }
    setSelectedAgencies(newSet);
  };

  const toggleMeeting = (meeting: string) => {
    const newSet = new Set(selectedMeetings);
    if (newSet.has(meeting)) {
      newSet.delete(meeting);
    } else {
      newSet.add(meeting);
    }
    setSelectedMeetings(newSet);
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      toast('検索キーワードを入力してください');
      return;
    }

    setLoading(true);
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
      
      if (selectedMeetings.size > 0) {
        params.append('meetings', Array.from(selectedMeetings).join(','));
      }
      
      const response = await fetch(`/api/search?${params}`);
      
      if (!response.ok) {
        throw new Error('Search request failed');
      }
      
      const data = await response.json();
      setSearchResults(data.hits || []);
      toast(`${data.count || 0}件の結果が見つかりました`);
      
      if (data.hits.length === 0) {
        toast('結果が見つかりませんでした。期間を拡大してみてください');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast('検索に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // 🔧 修正: バックエンドAPIを呼び出すように変更
  const handleSummarize = async (mode: string) => {
    setSummaryLoading(true);
    setSummaryMode(mode);
    
    try {
      let chunksToSummarize;
      if (mode === 'auto') {
        chunksToSummarize = filteredResults.slice(0, 3);
      } else {
        chunksToSummarize = filteredResults.filter(r => selectedDocs.has(r.doc_id));
      }

      if (chunksToSummarize.length === 0) {
        toast('要約する文書がありません');
        setSummaryLoading(false);
        return;
      }

      console.log('📝 Requesting summary for', chunksToSummarize.length, 'chunks');

      // ✅ バックエンドAPIを呼び出す
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query,
          chunks: chunksToSummarize.map(chunk => ({
            meeting: chunk.meeting,
            agency: chunk.agency,
            date: chunk.date,
            title: chunk.title,
            snippet: chunk.snippet,
            url: chunk.url,
            page_from: chunk.page_from,
            page_to: chunk.page_to
          }))
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Summary API error:', errorData);
        throw new Error(errorData.error || 'Summary generation failed');
      }

      const data = await response.json();
      
      setSummary(data);
      toast('要約を生成しました');
      
    } catch (error) {
      console.error('❌ Summary error:', error);
      toast(`要約生成に失敗しました: ${(error as Error).message}`);
    } finally {
      setSummaryLoading(false);
    }
  };

  const toggleDocSelection = (docId: string) => {
    const newSet = new Set(selectedDocs);
    if (newSet.has(docId)) {
      newSet.delete(docId);
    } else {
      newSet.add(docId);
    }
    setSelectedDocs(newSet);
  };

  const filteredResults = useMemo(() => {
    return searchResults.filter(result => {
      if (selectedAgencies.size > 0) {
        const agencyMatch = Array.from(selectedAgencies).some(agencyId => {
          const agency = AGENCIES.find(a => a.id === agencyId);
          return agency && result.agency === agency.name;
        });
        if (!agencyMatch) return false;
      }
      if (selectedMeetings.size > 0 && !selectedMeetings.has(result.meeting)) {
        return false;
      }
      return true;
    });
  }, [searchResults, selectedAgencies, selectedMeetings]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">政府IT会議ダッシュボード</h1>
          
          <div className="flex gap-3 mb-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="キーワードを入力（例: 生成AI、マイナンバー、データ連携）"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="self-center text-gray-500">〜</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2 font-medium"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              検索
            </button>
          </div>

          {(selectedAgencies.size > 0 || selectedMeetings.size > 0) && (
            <div className="flex flex-wrap gap-2">
              {Array.from(selectedAgencies).map(agencyId => {
                const agency = AGENCIES.find(a => a.id === agencyId);
                return (
                  <span key={agencyId} className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                    {agency?.name}
                    <button onClick={() => toggleAgency(agencyId)} className="hover:text-blue-900">×</button>
                  </span>
                );
              })}
              {Array.from(selectedMeetings).map(meeting => (
                <span key={meeting} className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                  {meeting}
                  <button onClick={() => toggleMeeting(meeting)} className="hover:text-green-900">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-3">
            <div className="bg-white rounded-lg border border-gray-200 p-4 sticky top-24">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                省庁・会議フィルタ
              </h3>
              <div className="space-y-3 max-h-[calc(100vh-200px)] overflow-y-auto">
                {AGENCIES.map(agency => (
                  <div key={agency.id}>
                    <label className="flex items-center gap-2 cursor-pointer mb-2">
                      <input
                        type="checkbox"
                        checked={selectedAgencies.has(agency.id)}
                        onChange={() => toggleAgency(agency.id)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="font-medium text-gray-700">{agency.name}</span>
                    </label>
                    {selectedAgencies.has(agency.id) && MEETINGS[agency.id] && (
                      <div className="ml-6 space-y-1.5">
                        {MEETINGS[agency.id].map(meeting => (
                          <label key={meeting} className="flex items-center gap-2 cursor-pointer text-sm">
                            <input
                              type="checkbox"
                              checked={selectedMeetings.has(meeting)}
                              onChange={() => toggleMeeting(meeting)}
                              className="w-3.5 h-3.5 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                            />
                            <span className="text-gray-600">{meeting}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-6">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                {filteredResults.length > 0 && `${filteredResults.length}件の結果`}
              </p>
            </div>

            {filteredResults.length === 0 && searchResults.length === 0 && !loading && (
              <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600 mb-2">検索キーワードを入力してください</p>
                <p className="text-sm text-gray-500">例: 生成AI、マイナンバー、データ連携、ガバメントクラウド</p>
              </div>
            )}

            {loading && (
              <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
                <Loader2 className="w-8 h-8 text-blue-600 mx-auto mb-3 animate-spin" />
                <p className="text-gray-600">検索中...</p>
              </div>
            )}

            <div className="space-y-4">
              {filteredResults.map(result => (
                <div key={result.doc_id} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedDocs.has(result.doc_id)}
                      onChange={() => toggleDocSelection(result.doc_id)}
                      className="mt-1 w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium">
                          {result.agency}
                        </span>
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                          {result.meeting}
                        </span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {result.date}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900 mb-2">{result.title}</h3>
                      <p className="text-sm text-gray-600 mb-3">{result.snippet}</p>
                      <div className="flex items-center gap-4 text-sm">
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          原文PDF
                        </a>
                        <span className="text-gray-500">p.{result.page_from}–{result.page_to}</span>
                        <span className="text-gray-400">スコア: {result.score.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-3">
            <div className="bg-white rounded-lg border border-gray-200 p-4 sticky top-24">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                要約生成
              </h3>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => handleSummarize('auto')}
                  disabled={filteredResults.length === 0 || summaryLoading}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  上位要約
                </button>
                <button
                  onClick={() => handleSummarize('selected')}
                  disabled={selectedDocs.size === 0 || summaryLoading}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  選択要約 ({selectedDocs.size})
                </button>
              </div>

              {summaryLoading && (
                <div className="text-center py-8">
                  <Loader2 className="w-6 h-6 text-blue-600 mx-auto mb-2 animate-spin" />
                  <p className="text-sm text-gray-600">要約生成中...</p>
                </div>
              )}

              {summary && !summaryLoading && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-xs">
                    {summary.cache.hit ? (
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        キャッシュ使用
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">
                        コスト: 約{Math.ceil((summary.cost_estimate.prompt_tokens + summary.cost_estimate.completion_tokens) / 1000 * 0.5)}円
                      </span>
                    )}
                  </div>

                  <div className="prose prose-sm max-w-none">
                    <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {summary.summary.split('\n').map((line: string, idx: number) => {
                        if (line.startsWith('**') && line.endsWith('**')) {
                          return <h4 key={idx} className="font-bold text-gray-900 mt-3 mb-1">{line.slice(2, -2)}</h4>;
                        } else if (line.startsWith('# ')) {
                          return <h3 key={idx} className="font-bold text-gray-900 mt-4 mb-2 text-base">{line.slice(2)}</h3>;
                        } else if (line.trim() === '') {
                          return <br key={idx} />;
                        } else {
                          const parts = line.split(/(\*\*.*?\*\*)/g);
                          return (
                            <p key={idx} className="mb-2">
                              {parts.map((part, i) => {
                                if (part.startsWith('**') && part.endsWith('**')) {
                                  return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
                                }
                                return <span key={i}>{part}</span>;
                              })}
                            </p>
                          );
                        }
                      })}
                    </div>
                  </div>

                  <div className="border-t border-gray-200 pt-3">
                    <p className="text-xs font-semibold text-gray-700 mb-2">出典</p>
                    <div className="space-y-2">
                      {summary.sources.map((source: any, idx: number) => (
                        <div key={idx} className="text-xs">
                          <a
                            href={source.doc_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-700 flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            {source.meeting}
                          </a>
                          <p className="text-gray-500 ml-4">
                            {source.date} (p.{source.pages})
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {!summary && !summaryLoading && (
                <div className="text-center py-8 text-sm text-gray-500">
                  検索結果から要約を生成できます
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-2">
          <Alert className="bg-white shadow-lg border border-gray-200">
            <AlertDescription className="flex items-center gap-2">
              <Check className="w-4 h-4 text-green-600" />
              {toastMessage}
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}