"""
デバッグ用: PDFファイルの状況を確認
"""

import json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
EXTRACTED_DIR = DATA_DIR / "extracted"

def main():
    print("🔍 Checking PDF processing status...")
    print("="*60)
    
    # collected_docs.json を確認
    docs_file = DATA_DIR / "collected_docs.json"
    if not docs_file.exists():
        print("❌ No collected_docs.json found")
        return
    
    with open(docs_file, 'r', encoding='utf-8') as f:
        documents = json.load(f)
    
    print(f"📊 Total documents: {len(documents)}")
    print("")
    
    # 処理状況を確認
    processed = 0
    unprocessed = 0
    missing_pdf = 0
    
    unprocessed_list = []
    
    for doc in documents:
        doc_id = doc['id']
        pdf_path = doc.get('pdf_path')
        output_file = EXTRACTED_DIR / f"{doc_id}.json"
        
        # PDFファイルの存在確認
        if not pdf_path or not Path(pdf_path).exists():
            missing_pdf += 1
            continue
        
        # 処理済みかチェック
        if output_file.exists():
            processed += 1
        else:
            unprocessed += 1
            file_size = Path(pdf_path).stat().st_size / (1024 * 1024)
            unprocessed_list.append({
                'id': doc_id,
                'title': doc['title'][:60],
                'size_mb': file_size,
                'path': pdf_path
            })
    
    print(f"✅ Already processed: {processed}")
    print(f"⏳ Unprocessed: {unprocessed}")
    print(f"❌ Missing PDF: {missing_pdf}")
    print("")
    
    if unprocessed > 0:
        print("📋 Next 5 PDFs to process:")
        print("-"*60)
        for i, item in enumerate(unprocessed_list[:5], 1):
            print(f"{i}. {item['title']}")
            print(f"   Size: {item['size_mb']:.1f}MB")
            print(f"   ID: {item['id']}")
            print("")
    
    # 推定時間
    if unprocessed > 0:
        avg_time_per_pdf = 60  # 1PDFあたり60秒と仮定
        workers = 2
        batch_size = 5
        
        batches_needed = (unprocessed + batch_size - 1) // batch_size
        time_per_batch = (batch_size / workers) * avg_time_per_pdf / 60
        
        print(f"⏱️  Estimated time:")
        print(f"   Batches needed: {batches_needed}")
        print(f"   Time per batch: ~{time_per_batch:.0f} minutes")
        print(f"   Total time: ~{batches_needed * time_per_batch / 60:.1f} hours")
    
    print("="*60)

if __name__ == "__main__":
    main()