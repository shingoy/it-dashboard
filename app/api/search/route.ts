/**
 * 検索API - BM25を使用した全文検索
 * 修正版: トークナイザーを改善し、英数字の短い単語にも対応
 */

import { NextRequest, NextResponse } from 'next/server';

interface Chunk {
  chunk_id: string;
  doc_id: string;
  text: string;
  full_text: string;
  tokens: string[];
  meeting: string;
  agency: string;
  title: string;
  date: string;
  url: string;
  page_from: number;
  page_to: number;
  char_count: number;
}

interface Shard {
  shard_id: string;
  group: string;
  chunk_count: number;
  chunks: Chunk[];
  idf: Record<string, number>;
}

interface ShardIndex {
  shard_id: string;
  filename: string;
  group: string;
  chunk_count: number;
}

// 改善版トークナイザー - シャード生成側と統一
function tokenize(text: string): string[] {
  // まず小文字化
  const lowerText = text.toLowerCase();
  const tokens: string[] = [];
  
  // 1. 日本語トークン (2-4文字)
  const japaneseTokens = lowerText.match(/[ぁ-んァ-ヶー一-龯]{2,4}/g) || [];
  tokens.push(...japaneseTokens);
  
  // 2. 英数字トークン (1文字以上)
  // 「ai」「dx」などの短い単語にも対応
  const alphanumeric = lowerText.match(/[a-z0-9]+/g) || [];
  tokens.push(...alphanumeric);
  
  // 3. 記号を除去した単語分割も試す
  const words = lowerText
    .replace(/[^\w\sぁ-んァ-ヶー一-龯]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
  tokens.push(...words);
  
  // 重複を除去
  const uniqueTokens = [...new Set(tokens)];
  
  return uniqueTokens;
}

// BM25スコア計算
function calculateBM25(
  queryTokens: string[],
  chunk: Chunk,
  idf: Record<string, number>,
  avgLength: number,
  k1: number = 1.5,
  b: number = 0.75
): number {
  const docLength = chunk.char_count;
  const docTokens = chunk.tokens;
  
  // トークン頻度カウント
  const termFreq: Record<string, number> = {};
  for (const token of docTokens) {
    termFreq[token] = (termFreq[token] || 0) + 1;
  }
  
  let score = 0;
  for (const token of queryTokens) {
    const tf = termFreq[token] || 0;
    const idfValue = idf[token] || 0;
    
    if (tf > 0) {
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgLength));
      score += idfValue * (numerator / denominator);
    }
  }
  
  return score;
}

// タイトルブースト
function titleBoost(queryTokens: string[], title: string): number {
  const titleTokens = tokenize(title);
  let matches = 0;
  for (const token of queryTokens) {
    if (titleTokens.includes(token)) {
      matches++;
    }
  }
  return matches * 2.0; // タイトルマッチは2倍
}

// ハイライト生成
function generateSnippet(text: string, queryTokens: string[], maxLength: number = 200): string {
  const lowerText = text.toLowerCase();
  let bestStart = 0;
  let maxMatches = 0;
  
  // クエリトークンが最も多く含まれる位置を探す
  for (let i = 0; i < text.length - maxLength; i += 50) {
    const window = lowerText.slice(i, i + maxLength);
    let matches = 0;
    for (const token of queryTokens) {
      if (window.includes(token.toLowerCase())) {
        matches++;
      }
    }
    if (matches > maxMatches) {
      maxMatches = matches;
      bestStart = i;
    }
  }
  
  let snippet = text.slice(bestStart, bestStart + maxLength);
  
  // 前後に...を付ける
  if (bestStart > 0) snippet = '...' + snippet;
  if (bestStart + maxLength < text.length) snippet = snippet + '...';
  
  return snippet.trim();
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const from = searchParams.get('from') || '2020-01-01';
    const to = searchParams.get('to') || '2030-12-31';
    const agencies = searchParams.get('agencies')?.split(',').filter(Boolean) || [];
    const meetings = searchParams.get('meetings')?.split(',').filter(Boolean) || [];
    const size = parseInt(searchParams.get('size') || '50');
    
    console.log('🔍 Search query:', query);
    
    if (!query.trim()) {
      return NextResponse.json({ hits: [], count: 0 });
    }
    
    // クエリトークン化
    const queryTokens = tokenize(query);
    console.log('📝 Query tokens:', queryTokens);
    
    if (queryTokens.length === 0) {
      return NextResponse.json({ hits: [], count: 0 });
    }
    
    // シャードインデックス読み込み
    const baseUrl = request.url.split('/api/')[0];
    const indexUrl = `${baseUrl}/index-shards/_index.json`;
    console.log('📂 Fetching index from:', indexUrl);
    
    const indexResponse = await fetch(indexUrl);
    
    if (!indexResponse.ok) {
      console.error('❌ Index fetch failed:', indexResponse.status);
      return NextResponse.json({ 
        error: 'Index not found',
        hits: [], 
        count: 0 
      });
    }
    
    const shardIndex: ShardIndex[] = await indexResponse.json();
    console.log('✅ Loaded shard index:', shardIndex.length, 'shards');
    
    // 関連するシャードを読み込み（全シャード）
    const shardPromises = shardIndex.map(async (shard) => {
      const url = `${baseUrl}/index-shards/${shard.filename}`;
      const response = await fetch(url);
      if (!response.ok) {
        console.error('❌ Shard fetch failed:', shard.filename, response.status);
        return null;
      }
      return response.json() as Promise<Shard>;
    });
    
    const shardResults = await Promise.all(shardPromises);
    const shards = shardResults.filter((s): s is Shard => s !== null);
    
    console.log('✅ Loaded shards:', shards.length);
    
    if (shards.length === 0) {
      return NextResponse.json({ 
        error: 'No shards loaded',
        hits: [], 
        count: 0 
      });
    }
    
    // デバッグ: 最初のシャードのIDFキーをサンプル表示
    if (shards.length > 0) {
      const sampleIdfKeys = Object.keys(shards[0].idf).slice(0, 30);
      console.log('🔑 Sample IDF keys from first shard:', sampleIdfKeys);
      
      // クエリトークンがIDFに存在するかチェック
      for (const token of queryTokens) {
        const exists = shards.some(shard => shard.idf[token] !== undefined);
        console.log(`🎯 Token "${token}" exists in IDF:`, exists);
      }
    }
    
    // 全チャンクを検索
    const results: Array<Chunk & { score: number; snippet: string }> = [];
    
    for (const shard of shards) {
      const avgLength = shard.chunks.reduce((sum, c) => sum + c.char_count, 0) / shard.chunks.length;
      
      for (const chunk of shard.chunks) {
        // 日付フィルタ
        if (chunk.date < from || chunk.date > to) continue;
        
        // 省庁フィルタ
        if (agencies.length > 0 && !agencies.includes(chunk.agency)) continue;
        
        // 会議フィルタ
        if (meetings.length > 0 && !meetings.includes(chunk.meeting)) continue;
        
        // BM25スコア計算
        const bm25Score = calculateBM25(queryTokens, chunk, shard.idf, avgLength);
        
        // タイトルブースト
        const titleScore = titleBoost(queryTokens, chunk.title);
        
        const totalScore = bm25Score + titleScore;
        
        if (totalScore > 0) {
          results.push({
            ...chunk,
            score: totalScore,
            snippet: generateSnippet(chunk.full_text || chunk.text, queryTokens)
          });
        }
      }
    }
    
    console.log('📊 Total results:', results.length);
    
    // スコア順にソート
    results.sort((a, b) => b.score - a.score);
    
    // 上位N件を返す
    const topResults = results.slice(0, size).map(r => ({
      doc_id: r.doc_id,
      chunk_id: r.chunk_id,
      meeting: r.meeting,
      agency: r.agency,
      date: r.date,
      title: r.title,
      snippet: r.snippet,
      score: Math.round(r.score * 10) / 10,
      url: r.url,
      page_from: r.page_from,
      page_to: r.page_to
    }));
    
    return NextResponse.json({
      hits: topResults,
      count: results.length,
      query: query,
      tokens: queryTokens
    });
    
  } catch (error) {
    console.error('❌ Search error:', error);
    return NextResponse.json(
      { 
        error: 'Search failed', 
        message: (error as Error).message,
        hits: [],
        count: 0
      },
      { status: 500 }
    );
  }
}