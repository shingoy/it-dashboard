/**
 * 要約API - Claude APIを使用して検索結果を要約
 */

import { NextRequest, NextResponse } from 'next/server';

interface SummarizeRequest {
  query: string;
  chunks: Array<{
    meeting: string;
    agency: string;
    date: string;
    title: string;
    snippet: string;
    url: string;
    page_from: number;
    page_to: number;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const body: SummarizeRequest = await request.json();
    const { query, chunks } = body;

    console.log('📝 Summarize request:', {
      query,
      chunkCount: chunks.length
    });

    if (!chunks || chunks.length === 0) {
      return NextResponse.json(
        { error: 'No chunks provided' },
        { status: 400 }
      );
    }

    // プロンプト生成
    const prompt = `以下は日本の政府IT関連会議の議事録・資料からの抜粋です。これらを統合して、主要なポイントを簡潔にまとめてください。

検索クエリ: ${query}

文書:
${chunks.map((chunk, idx) => `
【文書${idx + 1}】
会議: ${chunk.meeting}
省庁: ${chunk.agency}
日付: ${chunk.date}
タイトル: ${chunk.title}
内容: ${chunk.snippet}
`).join('\n')}

要約の要件:
- 検索クエリに関連する主要なポイントを3〜5つ程度にまとめる
- 各ポイントには適切な見出しをつける
- 具体的な取り組み内容や方針を含める
- 簡潔かつ分かりやすい日本語で記述する
- マークダウン形式で出力する（**太字**、見出しを使用）`;

    console.log('🤖 Calling Claude API...');

    // 環境変数からAPIキーを取得
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
    console.log('🔑 API Key check:', {
      exists: !!apiKey,
      prefix: apiKey?.slice(0, 10) || 'NOT SET',
      allEnvKeys: Object.keys(process.env).filter(k => k.includes('ANTHROPIC'))
    });
    
    if (!apiKey) {
      console.error('❌ ANTHROPIC_API_KEY is not set');
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    // Claude API呼び出し
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Claude API error:', response.status, errorText);
      return NextResponse.json(
        { 
          error: 'Claude API request failed',
          details: errorText
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    const summaryText = data.content[0].text;

    console.log('✅ Summary generated');

    // レスポンス
    return NextResponse.json({
      summary: summaryText,
      sources: chunks.map(chunk => ({
        doc_url: chunk.url,
        meeting: chunk.meeting,
        date: chunk.date,
        pages: `${chunk.page_from}-${chunk.page_to}`
      })),
      cache: {
        hit: false,
        key: 'claude_' + Date.now()
      },
      cost_estimate: {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0
      }
    });

  } catch (error) {
    console.error('❌ Summarize error:', error);
    return NextResponse.json(
      { 
        error: 'Summary generation failed',
        message: (error as Error).message
      },
      { status: 500 }
    );
  }
}