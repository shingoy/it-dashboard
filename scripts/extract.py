"""
PDF/HTMLからテキストを抽出し、チャンク化（増分処理版）
"""

import json
import re
from pathlib import Path
from typing import List, Dict
from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import time
import gc  # ガベージコレクション追加

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    print("⚠️  PyMuPDF not available")
    PYMUPDF_AVAILABLE = False

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = DATA_DIR / "cache"
EXTRACTED_DIR = DATA_DIR / "extracted"

EXTRACTED_DIR.mkdir(exist_ok=True)

# 環境変数で並列数を制御（デフォルト6）
MAX_WORKERS = int(os.environ.get('EXTRACT_MAX_WORKERS', '6'))
# 1回の実行で処理するPDFの最大数（デフォルト50）
BATCH_SIZE = int(os.environ.get('BATCH_SIZE', '50'))
# 個別PDFのタイムアウト（秒、デフォルト300秒=5分）
PDF_TIMEOUT = int(os.environ.get('PDF_TIMEOUT', '300'))

class TextExtractor:
    def __init__(self):
        self.chunk_size = 1200
        self.chunk_overlap = 200
    
    def extract_from_pdf(self, pdf_path: str) -> Dict:
        """PDFからテキストを抽出（メモリ効率化版）"""
        if not PYMUPDF_AVAILABLE:
            return {
                "success": False,
                "error": "PyMuPDF not installed"
            }
        
        doc = None
        try:
            doc = fitz.open(pdf_path)
            pages = []
            
            # ページごとに処理してメモリを節約
            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text()
                text = self.clean_text(text)
                
                if text.strip():
                    pages.append({
                        "page_num": page_num + 1,
                        "text": text,
                        "char_count": len(text)
                    })
                
                # ページ処理後は明示的に削除
                del page
            
            result = {
                "success": True,
                "pages": pages,
                "total_pages": len(pages),
                "total_chars": sum(p['char_count'] for p in pages)
            }
            
            return result
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
        finally:
            # 必ずドキュメントを閉じる
            if doc is not None:
                doc.close()
                del doc
    
    def clean_text(self, text: str) -> str:
        """テキストをクリーニング"""
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'\n\s*\n', '\n\n', text)
        text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', text)
        return text.strip()
    
    def create_chunks(self, pages: List[Dict], doc_id: str, metadata: Dict) -> List[Dict]:
        """ページをチャンクに分割"""
        chunks = []
        chunk_index = 0
        
        full_text = "\n\n".join([p['text'] for p in pages])
        
        page_boundaries = []
        current_pos = 0
        for page in pages:
            page_text = page['text']
            page_boundaries.append({
                'page_num': page['page_num'],
                'start': current_pos,
                'end': current_pos + len(page_text)
            })
            current_pos += len(page_text) + 2
        
        start = 0
        while start < len(full_text):
            end = start + self.chunk_size
            
            if end < len(full_text):
                period_pos = full_text.rfind('。', start, end + 100)
                if period_pos > start:
                    end = period_pos + 1
            
            chunk_text = full_text[start:end].strip()
            
            if chunk_text:
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
        
        if page_from is None:
            page_from = page_boundaries[0]['page_num'] if page_boundaries else 1
        if page_to is None:
            page_to = page_boundaries[-1]['page_num'] if page_boundaries else 1
        
        return page_from, page_to
    
    def extract_keywords(self, text: str, top_n: int = 10) -> List[Dict]:
        """簡易的なキーワード抽出"""
        stop_words = set(['こと', 'もの', 'ため', 'よう', 'これ', 'それ', 'など', 'について', 'における'])
        words = re.findall(r'[ぁ-んァ-ヶー一-龯]{2,4}', text)
        
        word_freq = {}
        for word in words:
            if word not in stop_words:
                word_freq[word] = word_freq.get(word, 0) + 1
        
        sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)[:top_n]
        return [{"term": word, "count": count} for word, count in sorted_words]
    
    def is_already_processed(self, doc_id: str) -> bool:
        """既に処理済みかチェック"""
        output_file = EXTRACTED_DIR / f"{doc_id}.json"
        return output_file.exists()
    
    def process_document_with_timeout(self, doc: Dict, index: int, total: int) -> Dict:
        """タイムアウト付きでドキュメントを処理"""
        doc_id = doc['id']
        
        # 既に処理済みならスキップ
        if self.is_already_processed(doc_id):
            print(f"  [{index}/{total}] ⏭️  Already processed: {doc_id}")
            return {
                "doc_id": doc_id,
                "success": True,
                "already_processed": True
            }
        
        # 通常処理（タイムアウトは外部のExecutorで管理）
        try:
            return self.process_document(doc, index, total)
        except Exception as e:
            print(f"  [{index}/{total}] ❌ Exception: {str(e)[:100]}")
            return {
                "doc_id": doc_id,
                "success": False,
                "error": str(e)
            }
    
    def process_document(self, doc: Dict, index: int, total: int) -> Dict:
        """1つのドキュメントを処理"""
        doc_id = doc['id']
        pdf_path = doc.get('pdf_path')
        
        if not pdf_path or not Path(pdf_path).exists():
            print(f"  [{index}/{total}] ❌ {doc_id}: PDF file not found")
            return {
                "doc_id": doc_id,
                "success": False,
                "error": "PDF file not found"
            }
        
        # ファイルサイズをチェック
        file_size_mb = Path(pdf_path).stat().st_size / (1024 * 1024)
        print(f"  [{index}/{total}] 📄 Processing: {doc['title'][:50]} ({file_size_mb:.1f}MB)...")
        
        start_time = time.time()
        extraction = self.extract_from_pdf(pdf_path)
        
        if not extraction['success']:
            print(f"  [{index}/{total}] ❌ Extraction failed: {extraction.get('error', 'Unknown error')}")
            return {
                "doc_id": doc_id,
                "success": False,
                "error": extraction.get('error')
            }
        
        metadata = {
            "meeting": doc['meeting'],
            "agency": doc['agency'],
            "title": doc['title'],
            "date": doc['date'],
            "url": doc['url']
        }
        
        chunks = self.create_chunks(extraction['pages'], doc_id, metadata)
        
        full_text = "\n".join([p['text'] for p in extraction['pages']])
        keywords = self.extract_keywords(full_text)
        
        output = {
            "doc_id": doc_id,
            "metadata": metadata,
            "pages": len(extraction['pages']),
            "chunks": chunks,
            "keywords": keywords
        }
        
        output_file = EXTRACTED_DIR / f"{doc_id}.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        
        elapsed = time.time() - start_time
        print(f"  [{index}/{total}] ✓ Extracted {len(chunks)} chunks in {elapsed:.1f}s")
        
        return {
            "doc_id": doc_id,
            "success": True,
            "chunks_count": len(chunks),
            "keywords_count": len(keywords),
            "processing_time": elapsed
        }
    
    def process_all(self):
        """全ドキュメントを増分処理"""
        docs_file = DATA_DIR / "collected_docs.json"
        if not docs_file.exists():
            print("❌ No collected documents found")
            return
        
        with open(docs_file, 'r', encoding='utf-8') as f:
            all_documents = json.load(f)
        
        # 未処理のドキュメントのみを抽出
        unprocessed_docs = [
            doc for doc in all_documents 
            if not self.is_already_processed(doc['id'])
        ]
        
        # バッチサイズに制限
        documents = unprocessed_docs[:BATCH_SIZE]
        
        total = len(documents)
        total_all = len(all_documents)
        already_processed = len(all_documents) - len(unprocessed_docs)
        
        print(f"📊 Status:")
        print(f"   Total documents: {total_all}")
        print(f"   Already processed: {already_processed}")
        print(f"   Remaining: {len(unprocessed_docs)}")
        print(f"   Processing this batch: {total}")
        print(f"   Workers: {MAX_WORKERS}")
        print("")
        
        if total == 0:
            print("✅ All documents already processed!")
            return
        
        results = []
        timeouts = 0
        
        # 並列処理（タイムアウト付き）
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_doc = {}
            
            for i, doc in enumerate(documents):
                future = executor.submit(self.process_document_with_timeout, doc, i+1, total)
                future_to_doc[future] = doc
            
            # タイムアウト付きで結果を取得
            for future in as_completed(future_to_doc, timeout=PDF_TIMEOUT + 10):
                try:
                    result = future.result(timeout=PDF_TIMEOUT)
                    results.append(result)
                except TimeoutError:
                    doc = future_to_doc[future]
                    print(f"  ⏱️  TIMEOUT: {doc['title'][:50]}")
                    timeouts += 1
                    results.append({
                        "doc_id": doc['id'],
                        "success": False,
                        "error": "Processing timeout",
                        "timeout": True
                    })
                except Exception as e:
                    doc = future_to_doc[future]
                    print(f"  ❌ Exception processing {doc['id']}: {e}")
                    results.append({
                        "doc_id": doc['id'],
                        "success": False,
                        "error": str(e)
                    })
        
        summary = {
            "total_documents": total_all,
            "already_processed": already_processed,
            "batch_size": total,
            "successful": sum(1 for r in results if r['success'] and not r.get('already_processed')),
            "already_processed_in_batch": sum(1 for r in results if r.get('already_processed')),
            "failed": sum(1 for r in results if not r['success']),
            "timeout": sum(1 for r in results if r.get('timeout')),
            "remaining": len(unprocessed_docs) - total,
            "results": results
        }
        
        summary_file = DATA_DIR / "extraction_summary.json"
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ Batch extraction complete!")
        print(f"   Processed: {summary['successful']}")
        print(f"   Failed: {summary['failed']}")
        print(f"   Timeout: {summary['timeout']}")
        print(f"   Remaining: {summary['remaining']}")
        print(f"   Progress: {already_processed + summary['successful']}/{total_all} ({(already_processed + summary['successful'])/total_all*100:.1f}%)")

def main():
    import datetime
    start_time = datetime.datetime.now()
    
    print("🚀 Starting incremental text extraction")
    print(f"⏰ Start time: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)
    print(f"   Max workers: {MAX_WORKERS}")
    print(f"   Batch size: {BATCH_SIZE}")
    print(f"   PDF timeout: {PDF_TIMEOUT}s")
    print("="*60)
    
    extractor = TextExtractor()
    extractor.process_all()
    
    end_time = datetime.datetime.now()
    elapsed = (end_time - start_time).total_seconds()
    
    print("="*60)
    print(f"✅ Total time: {elapsed:.1f}s ({elapsed/60:.1f}min)")
    print(f"⏰ End time: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == "__main__":
    main()