/**
 * 検索API - BM25を使用した全文検索
 * 修正版: トークン化ロジックを統一
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

interface Chunk {
  chunk_id: string;
  doc_id: string;
  text: string;
  tokens: string[];
  token_count: number;
  meeting: string;
  agency: string;
  title: string;
  date: string;
  url: string;
  page_from: number;
  page_to: number;
  char_count: number;
  avg_length: number;
  k1: number;
  b: number;
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

// トークナイザー - Python側と完全に一致
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  
  // 1. 日本語トークン (2-4文字)
  const japaneseTokens = text.match(/[ぁ-んァ-ヶー一-龯]{2,4}/g) || [];
  tokens.push(...japaneseTokens);
  
  // 2. 英数字トークン
  const alphanumeric = text.match(/[A-Za-z0-9]+/g) || [];
  tokens.push(...alphanumeric);
  
  // 小文字化
  return tokens.map(t => t.toLowerCase());
}

// BM25スコア計算
function calculateBM25(
  queryTokens: string[],
  chunk: Chunk,
  idf: Record<string, number>
): number {
  const docLength = chunk.char_count;
  const avgLength = chunk.avg_length;
  const k1 = chunk.k1;
  const b = chunk.b;
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
    
    if (tf > 0 && idfValue > 0) {
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
    
    // public/index-shards/ のパス
    const indexShardsDir = path.join(process.cwd(), 'public', 'index-shards');
    const indexPath = path.join(indexShardsDir, '_index.json');
    
    console.log('📂 Reading index from:', indexPath);
    
    // シャードインデックス読み込み
    let shardIndex: ShardIndex[];
    try {
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      shardIndex = JSON.parse(indexContent);
      console.log('✅ Loaded shard index:', shardIndex.length, 'shards');
    } catch (error) {
      console.error('❌ Index file not found:', error);
      return NextResponse.json({ 
        error: 'Index not found',
        message: 'インデックスファイルが見つかりません。GitHub Actionsが実行されているか確認してください。',
        hits: [], 
        count: 0 
      }, { status: 404 });
    }
    
    // 関連するシャードを読み込み
    const shardPromises = shardIndex.map(async (shard) => {
      const shardPath = path.join(indexShardsDir, shard.filename);
      try {
        const shardContent = await fs.readFile(shardPath, 'utf-8');
        return JSON.parse(shardContent) as Shard;
      } catch (error) {
        console.error('⚠️ Shard file not found:', shard.filename);
        return null;
      }
    });
    
    const shardResults = await Promise.all(shardPromises);
    const shards = shardResults.filter((s): s is Shard => s !== null);
    
    console.log('✅ Loaded shards:', shards.length);
    
    if (shards.length === 0) {
      return NextResponse.json({ 
        error: 'No shards loaded',
        message: 'シャードファイルが見つかりません。',
        hits: [], 
        count: 0 
      }, { status: 404 });
    }
    
    // デバッグ: 最初のシャードの情報
    if (shards.length > 0 && shards[0].idf) {
      const sampleIdfKeys = Object.keys(shards[0].idf).slice(0, 20);
      console.log('🔑 Sample IDF keys:', sampleIdfKeys);
      
      // 最初のチャンクの情報を表示
      if (shards[0].chunks.length > 0) {
        const firstChunk = shards[0].chunks[0];
        console.log('📄 First chunk info:');
        console.log('  - has tokens:', !!firstChunk.tokens);
        console.log('  - tokens count:', firstChunk.tokens?.length || 0);
        console.log('  - sample tokens:', firstChunk.tokens?.slice(0, 10));
        console.log('  - text preview:', firstChunk.text?.substring(0, 100));
      }
      
      // クエリトークンがIDFに存在するかチェック
      for (const token of queryTokens) {
        const idfValue = shards[0].idf[token];
        if (idfValue) {
          console.log(`✅ Token "${token}" IDF:`, idfValue);
        } else {
          console.log(`⚠️ Token "${token}" not in IDF`);
        }
      }
    }
    
    // 全チャンクを検索
    const results: Array<Chunk & { score: number; snippet: string }> = [];
    
    let totalChunks = 0;
    let filteredByDate = 0;
    let filteredByAgency = 0;
    let filteredByMeeting = 0;
    let scoreZero = 0;
    
    for (const shard of shards) {
      for (const chunk of shard.chunks) {
        totalChunks++;
        
        // 日付フィルタ
        if (chunk.date < from || chunk.date > to) {
          filteredByDate++;
          continue;
        }
        
        // 省庁フィルタ
        if (agencies.length > 0 && !agencies.includes(chunk.agency)) {
          filteredByAgency++;
          continue;
        }
        
        // 会議フィルタ
        if (meetings.length > 0 && !meetings.includes(chunk.meeting)) {
          filteredByMeeting++;
          continue;
        }
        
        // BM25スコア計算
        const bm25Score = calculateBM25(queryTokens, chunk, shard.idf);
        
        // タイトルブースト
        const titleScore = titleBoost(queryTokens, chunk.title);
        
        const totalScore = bm25Score + titleScore;
        
        if (totalScore > 0) {
          results.push({
            ...chunk,
            score: totalScore,
            snippet: generateSnippet(chunk.text, queryTokens)
          });
        } else {
          scoreZero++;
        }
      }
    }
    
    console.log('📊 Search statistics:');
    console.log('  Total chunks scanned:', totalChunks);
    console.log('  Filtered by date:', filteredByDate);
    console.log('  Filtered by agency:', filteredByAgency);
    console.log('  Filtered by meeting:', filteredByMeeting);
    console.log('  Score = 0:', scoreZero);
    console.log('  Results with score > 0:', results.length);
    
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