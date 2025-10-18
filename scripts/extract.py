"""
PDF/HTMLからテキストを抽出し、チャンク化
"""

import json
import re
from pathlib import Path
from typing import List, Dict


BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = DATA_DIR / "cache"
EXTRACTED_DIR = DATA_DIR / "extracted"

EXTRACTED_DIR.mkdir(exist_ok=True)

class TextExtractor:
    def __init__(self):
        self.chunk_size = 1200  # 文字数
        self.chunk_overlap = 200
    
    def extract_from_pdf(self, pdf_path: str) -> Dict:
        """PDFからテキストを抽出"""
        try:
            doc = pymupdf.open(pdf_path)
            pages = []
            
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text()
                
                # テキストのクリーニング
                text = self.clean_text(text)
                
                if text.strip():
                    pages.append({
                        "page_num": page_num + 1,
                        "text": text,
                        "char_count": len(text)
                    })
            
            doc.close()
            
            return {
                "success": True,
                "pages": pages,
                "total_pages": len(pages),
                "total_chars": sum(p['char_count'] for p in pages)
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def clean_text(self, text: str) -> str:
        """テキストをクリーニング"""
        # 連続する空白を1つに
        text = re.sub(r'\s+', ' ', text)
        # 改行の正規化
        text = re.sub(r'\n\s*\n', '\n\n', text)
        # 制御文字を削除
        text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', text)
        return text.strip()
    
    def create_chunks(self, pages: List[Dict], doc_id: str, metadata: Dict) -> List[Dict]:
        """ページをチャンクに分割"""
        chunks = []
        chunk_index = 0
        
        # 全ページのテキストを結合
        full_text = "\n\n".join([p['text'] for p in pages])
        
        # ページ境界情報を保持
        page_boundaries = []
        current_pos = 0
        for page in pages:
            page_text = page['text']
            page_boundaries.append({
                'page_num': page['page_num'],
                'start': current_pos,
                'end': current_pos + len(page_text)
            })
            current_pos += len(page_text) + 2  # \n\n分
        
        # チャンク分割
        start = 0
        while start < len(full_text):
            end = start + self.chunk_size
            
            # 文の区切りで分割を調整
            if end < len(full_text):
                # 句点で区切る
                period_pos = full_text.rfind('。', start, end + 100)
                if period_pos > start:
                    end = period_pos + 1
            
            chunk_text = full_text[start:end].strip()
            
            if chunk_text:
                # このチャンクがどのページにまたがるかを判定
                page_from, page_to = self.get_page_range(start, end, page_boundaries)
                
                chunks.append({
                    "chunk_id": f"{doc_id}_c{chunk_index}",
                    "doc_id": doc_id,
                    "chunk_index": chunk_index,
                    "text": chunk_text,
                    "page_from": page_from,
                    "page_to": page_to,
                    "char_count": len(chunk_text),
                    "position": start,
                    **metadata
                })
                
                chunk_index += 1
            
            # オーバーラップを考慮して次の開始位置を設定
            start = end - self.chunk_overlap
            if start >= len(full_text):
                break
        
        return chunks
    
    def get_page_range(self, start: int, end: int, page_boundaries: List[Dict]) -> tuple:
        """チャンクの開始・終了位置から該当ページ範囲を取得"""
        page_from = None
        page_to = None
        
        for boundary in page_boundaries:
            if page_from is None and start >= boundary['start'] and start < boundary['end']:
                page_from = boundary['page_num']
            if end >= boundary['start'] and end <= boundary['end']:
                page_to = boundary['page_num']
        
        # 見つからない場合は最初/最後のページ
        if page_from is None:
            page_from = page_boundaries[0]['page_num'] if page_boundaries else 1
        if page_to is None:
            page_to = page_boundaries[-1]['page_num'] if page_boundaries else 1
        
        return page_from, page_to
    
    def extract_keywords(self, text: str, top_n: int = 10) -> List[Dict]:
        """簡易的なキーワード抽出（TF-IDF風）"""
        # 頻出する一般的な単語を除外
        stop_words = set(['こと', 'もの', 'ため', 'よう', 'これ', 'それ', 'など', 'について', 'における'])
        
        # 2-4文字の単語を抽出
        words = re.findall(r'[ぁ-んァ-ヶー一-龯]{2,4}', text)
        
        # 頻度カウント
        word_freq = {}
        for word in words:
            if word not in stop_words:
                word_freq[word] = word_freq.get(word, 0) + 1
        
        # 上位N件を取得
        sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)[:top_n]
        
        return [{"term": word, "count": count} for word, count in sorted_words]
    
    def process_document(self, doc: Dict) -> Dict:
        """1つのドキュメントを処理"""
        doc_id = doc['id']
        pdf_path = doc.get('pdf_path')
        
        if not pdf_path or not Path(pdf_path).exists():
            return {
                "doc_id": doc_id,
                "success": False,
                "error": "PDF file not found"
            }
        
        print(f"📄 Processing: {doc['title'][:50]}...")
        
        # テキスト抽出
        extraction = self.extract_from_pdf(pdf_path)
        
        if not extraction['success']:
            print(f"  ❌ Extraction failed: {extraction['error']}")
            return {
                "doc_id": doc_id,
                "success": False,
                "error": extraction['error']
            }
        
        # メタデータ準備
        metadata = {
            "meeting": doc['meeting'],
            "agency": doc['agency'],
            "title": doc['title'],
            "date": doc['date'],
            "url": doc['url']
        }
        
        # チャンク作成
        chunks = self.create_chunks(extraction['pages'], doc_id, metadata)
        
        # キーワード抽出（全文から）
        full_text = "\n".join([p['text'] for p in extraction['pages']])
        keywords = self.extract_keywords(full_text)
        
        # 結果を保存
        output = {
            "doc_id": doc_id,
            "metadata": metadata,
            "pages": len(extraction['pages']),
            "chunks": chunks,
            "keywords": keywords,
            "extracted_at": extraction.get('extracted_at')
        }
        
        output_file = EXTRACTED_DIR / f"{doc_id}.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        
        print(f"  ✓ Extracted {len(chunks)} chunks, {len(keywords)} keywords")
        
        return {
            "doc_id": doc_id,
            "success": True,
            "chunks_count": len(chunks),
            "keywords_count": len(keywords)
        }
    
    def process_all(self):
        """全ドキュメントを処理"""
        # 収集済みドキュメント一覧を読み込み
        docs_file = DATA_DIR / "collected_docs.json"
        if not docs_file.exists():
            print("❌ No collected documents found. Run crawl.py first.")
            return
        
        with open(docs_file, 'r', encoding='utf-8') as f:
            documents = json.load(f)
        
        print(f"🔍 Processing {len(documents)} documents...")
        
        results = []
        for doc in documents:
            result = self.process_document(doc)
            results.append(result)
        
        # 結果サマリーを保存
        summary = {
            "total_documents": len(documents),
            "successful": sum(1 for r in results if r['success']),
            "failed": sum(1 for r in results if not r['success']),
            "results": results
        }
        
        summary_file = DATA_DIR / "extraction_summary.json"
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ Extraction complete!")
        print(f"   Success: {summary['successful']}")
        print(f"   Failed: {summary['failed']}")

def main():
    print("🚀 Starting text extraction")
    print("="*60)
    
    extractor = TextExtractor()
    extractor.process_all()
    
    print("="*60)

if __name__ == "__main__":
    main()
