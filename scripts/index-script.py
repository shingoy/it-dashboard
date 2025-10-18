"""
検索インデックス生成スクリプト
BM25用のインデックスとトレンド集計JSONを生成
"""

import json
import math
import re
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime
from typing import List, Dict

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
EXTRACTED_DIR = DATA_DIR / "extracted"
PUBLIC_DIR = BASE_DIR / "public"
INDEX_DIR = PUBLIC_DIR / "index-shards"
TRENDS_DIR = PUBLIC_DIR / "trends"

INDEX_DIR.mkdir(parents=True, exist_ok=True)
TRENDS_DIR.mkdir(parents=True, exist_ok=True)

class IndexBuilder:
    def __init__(self):
        self.all_chunks = []
        self.all_docs = []
        self.idf_cache = {}
        
    def tokenize(self, text: str) -> List[str]:
        """日本語テキストをトークン化（簡易版）"""
        # 2-4文字の日本語単語を抽出
        tokens = re.findall(r'[ぁ-んァ-ヶー一-龯]{2,4}', text)
        # 英数字も抽出
        tokens.extend(re.findall(r'[A-Za-z0-9]+', text))
        return [t.lower() for t in tokens]
    
    def calculate_bm25_scores(self, chunks: List[Dict]) -> List[Dict]:
        """BM25スコア計算のための統計情報を追加"""
        # パラメータ
        k1 = 1.5
        b = 0.75
        
        # 全チャンクの平均文字数
        avg_length = sum(c['char_count'] for c in chunks) / len(chunks) if chunks else 1
        
        # 各チャンクにトークンを追加
        for chunk in chunks:
            chunk['tokens'] = self.tokenize(chunk['text'])
            chunk['token_count'] = len(chunk['tokens'])
        
        # IDF計算
        total_docs = len(chunks)
        doc_freq = defaultdict(int)
        
        for chunk in chunks:
            unique_tokens = set(chunk['tokens'])
            for token in unique_tokens:
                doc_freq[token] += 1
        
        # IDF値を計算してキャッシュ
        for token, df in doc_freq.items():
            idf = math.log((total_docs - df + 0.5) / (df + 0.5) + 1)
            self.idf_cache[token] = idf
        
        # 各チャンクのBM25用統計情報を追加
        for chunk in chunks:
            chunk['avg_length'] = avg_length
            chunk['k1'] = k1
            chunk['b'] = b
        
        return chunks
    
    def create_shards(self, chunks: List[Dict], shard_size: int = 100):
        """チャンクをシャードに分割"""
        # 会議×月でグループ化
        groups = defaultdict(list)
        
        for chunk in chunks:
            # YYYY-MM形式
            month_key = chunk['date'][:7] if chunk.get('date') else '2025-01'
            meeting = chunk.get('meeting', 'unknown')
            key = f"{meeting}_{month_key}"
            groups[key].append(chunk)
        
        # シャード生成
        shards = []
        for group_key, group_chunks in groups.items():
            # グループが大きい場合は分割
            for i in range(0, len(group_chunks), shard_size):
                shard_chunks = group_chunks[i:i+shard_size]
                
                # 軽量化: 検索に不要なフィールドを除外
                lightweight_chunks = []
                for chunk in shard_chunks:
                    lightweight_chunks.append({
                        'chunk_id': chunk['chunk_id'],
                        'doc_id': chunk['doc_id'],
                        'text': chunk['text'][:500],  # スニペット用に短縮
                        'full_text': chunk['text'],  # 検索用
                        'tokens': chunk['tokens'][:100],  # トークン数制限
                        'meeting': chunk['meeting'],
                        'agency': chunk['agency'],
                        'title': chunk['title'],
                        'date': chunk['date'],
                        'url': chunk['url'],
                        'page_from': chunk['page_from'],
                        'page_to': chunk['page_to'],
                        'char_count': chunk['char_count']
                    })
                
                shard = {
                    'shard_id': f"{group_key}_{i//shard_size}",
                    'group': group_key,
                    'chunk_count': len(shard_chunks),
                    'chunks': lightweight_chunks,
                    'idf': self.idf_cache  # IDF情報を含める
                }
                
                shards.append(shard)
        
        return shards
    
    def save_shards(self, shards: List[Dict]):
        """シャードをファイルに保存"""
        shard_index = []
        
        for shard in shards:
            shard_id = shard['shard_id']
            filename = f"{shard_id}.json"
            filepath = INDEX_DIR / filename
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(shard, f, ensure_ascii=False, separators=(',', ':'))
            
            # インデックスメタデータ
            shard_index.append({
                'shard_id': shard_id,
                'filename': filename,
                'group': shard['group'],
                'chunk_count': shard['chunk_count']
            })
            
            print(f"  ✓ Saved shard: {filename} ({shard['chunk_count']} chunks)")
        
        # シャードインデックスを保存
        index_file = INDEX_DIR / "_index.json"
        with open(index_file, 'w', encoding='utf-8') as f:
            json.dump(shard_index, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ Saved {len(shards)} shards to {INDEX_DIR}")
    
    def create_docs_meta(self):
        """ドキュメント一覧メタデータを生成"""
        docs_meta = []
        
        for doc in self.all_docs:
            docs_meta.append({
                'doc_id': doc['doc_id'],
                'meeting': doc['metadata']['meeting'],
                'agency': doc['metadata']['agency'],
                'title': doc['metadata']['title'],
                'date': doc['metadata']['date'],
                'url': doc['metadata']['url'],
                'pages': doc['pages'],
                'chunks_count': len(doc['chunks'])
            })
        
        meta_file = PUBLIC_DIR / "docs-meta.json"
        with open(meta_file, 'w', encoding='utf-8') as f:
            json.dump(docs_meta, f, ensure_ascii=False, indent=2)
        
        print(f"✅ Saved docs metadata: {meta_file}")
    
    def generate_trends(self):
        """月次トレンド集計"""
        # 月ごとにグループ化
        monthly_data = defaultdict(lambda: {
            'keywords': Counter(),
            'meetings': Counter(),
            'docs': []
        })
        
        for chunk in self.all_chunks:
            month = chunk['date'][:7] if chunk.get('date') else '2025-01'
            
            # キーワード集計
            for token in chunk.get('tokens', [])[:50]:
                monthly_data[month]['keywords'][token] += 1
            
            # 会議別カウント
            meeting = chunk.get('meeting', 'unknown')
            monthly_data[month]['meetings'][meeting] += 1
            
            # ドキュメント記録
            if chunk['doc_id'] not in [d['doc_id'] for d in monthly_data[month]['docs']]:
                monthly_data[month]['docs'].append({
                    'doc_id': chunk['doc_id'],
                    'title': chunk['title'],
                    'meeting': chunk['meeting']
                })
        
        # 月ごとにファイル保存
        for month, data in monthly_data.items():
            # 上位キーワード
            top_keywords = [
                {'term': term, 'count': count}
                for term, count in data['keywords'].most_common(50)
            ]
            
            # 会議別カウント
            meeting_counts = [
                {'meeting': meeting, 'count': count}
                for meeting, count in data['meetings'].most_common()
            ]
            
            trend_data = {
                'month': month,
                'keywords': top_keywords,
                'meetings': meeting_counts,
                'doc_count': len(data['docs']),
                'chunk_count': sum(data['meetings'].values())
            }
            
            trend_file = TRENDS_DIR / f"{month}.json"
            with open(trend_file, 'w', encoding='utf-8') as f:
                json.dump(trend_data, f, ensure_ascii=False, indent=2)
            
            print(f"  ✓ Generated trend: {month}")
        
        print(f"\n✅ Generated {len(monthly_data)} monthly trends")
    
    def load_all_extractions(self):
        """全抽出データを読み込み"""
        extraction_files = list(EXTRACTED_DIR.glob("*.json"))
        
        if not extraction_files:
            print("❌ No extracted files found. Run extract.py first.")
            return False
        
        print(f"📚 Loading {len(extraction_files)} extracted documents...")
        
        for file in extraction_files:
            with open(file, 'r', encoding='utf-8') as f:
                doc_data = json.load(f)
                self.all_docs.append(doc_data)
                self.all_chunks.extend(doc_data['chunks'])
        
        print(f"   Loaded {len(self.all_docs)} documents")
        print(f"   Loaded {len(self.all_chunks)} chunks")
        
        return True
    
    def build(self):
        """インデックスをビルド"""
        print("🚀 Building search index")
        print("="*60)
        
        # データ読み込み
        if not self.load_all_extractions():
            return
        
        # BM25統計計算
        print("\n📊 Calculating BM25 statistics...")
        self.all_chunks = self.calculate_bm25_scores(self.all_chunks)
        
        # シャード作成
        print("\n🔨 Creating shards...")
        shards = self.create_shards(self.all_chunks)
        self.save_shards(shards)
        
        # ドキュメントメタデータ
        print("\n📋 Creating document metadata...")
        self.create_docs_meta()
        
        # トレンド集計
        print("\n📈 Generating trends...")
        self.generate_trends()
        
        print("\n" + "="*60)
        print("✨ Index build complete!")
        print(f"   Total chunks: {len(self.all_chunks)}")
        print(f"   Total shards: {len(shards)}")
        print(f"   Output directory: {PUBLIC_DIR}")
        print("="*60)

def main():
    builder = IndexBuilder()
    builder.build()

if __name__ == "__main__":
    main()
