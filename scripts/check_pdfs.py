"""
収集されたPDFの状況を確認
"""

import json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"

def check_pdfs():
    docs_file = DATA_DIR / "collected_docs.json"
    
    if not docs_file.exists():
        print("❌ No collected_docs.json found")
        return
    
    with open(docs_file, 'r', encoding='utf-8') as f:
        documents = json.load(f)
    
    print(f"📊 Total documents: {len(documents)}")
    print("="*60)
    
    # PDFファイルの存在確認
    pdf_exists = 0
    pdf_missing = 0
    total_size = 0
    size_by_file = []
    
    for doc in documents:
        pdf_path = doc.get('pdf_path')
        if pdf_path and Path(pdf_path).exists():
            pdf_exists += 1
            size = Path(pdf_path).stat().st_size
            total_size += size
            size_by_file.append({
                'title': doc['title'][:50],
                'size_mb': size / (1024 * 1024),
                'path': pdf_path
            })
        else:
            pdf_missing += 1
    
    print(f"✅ PDFs exist: {pdf_exists}")
    print(f"❌ PDFs missing: {pdf_missing}")
    print(f"📦 Total size: {total_size / (1024*1024):.2f} MB")
    print(f"📈 Average size: {total_size / pdf_exists / (1024*1024):.2f} MB" if pdf_exists > 0 else "N/A")
    print("="*60)
    
    # 大きいファイルトップ10
    size_by_file.sort(key=lambda x: x['size_mb'], reverse=True)
    print("\n🔝 Largest PDFs (Top 10):")
    for i, item in enumerate(size_by_file[:10], 1):
        print(f"  {i}. {item['title']} - {item['size_mb']:.2f} MB")
    
    print("="*60)
    
    # 推定処理時間
    if pdf_exists > 0:
        # 仮定: 1MB = 5秒, 4並列
        estimated_time_sec = (total_size / (1024*1024)) * 5 / 4
        estimated_time_min = estimated_time_sec / 60
        print(f"\n⏱️  Estimated processing time:")
        print(f"   Sequential: {estimated_time_sec * 4 / 60:.1f} minutes")
        print(f"   Parallel (4 workers): {estimated_time_min:.1f} minutes")
        
        if estimated_time_min > 20:
            print(f"\n⚠️  WARNING: Estimated time exceeds 20 minutes!")
            print(f"   Recommended: Set MAX_DOCUMENTS to {int(pdf_exists * 20 / estimated_time_min)}")

if __name__ == "__main__":
    check_pdfs()