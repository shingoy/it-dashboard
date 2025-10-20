"""
collected_docs.json の pdf_path を修復するスクリプト
"""

import json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = DATA_DIR / "cache"

def fix_pdf_paths():
    docs_file = DATA_DIR / "collected_docs.json"
    
    if not docs_file.exists():
        print("❌ collected_docs.json not found")
        return
    
    # ドキュメント読み込み
    with open(docs_file, 'r', encoding='utf-8') as f:
        documents = json.load(f)
    
    print(f"📚 Found {len(documents)} documents")
    
    fixed_count = 0
    missing_count = 0
    
    for doc in documents:
        doc_id = doc['id']
        cache_path = CACHE_DIR / f"{doc_id}.pdf"
        
        # pdf_pathが設定されていないか、ファイルが存在しない場合
        if not doc.get('pdf_path') or not Path(doc['pdf_path']).exists():
            if cache_path.exists():
                doc['pdf_path'] = str(cache_path)
                fixed_count += 1
                print(f"  ✓ Fixed: {doc_id} -> {doc['title'][:40]}")
            else:
                missing_count += 1
                print(f"  ❌ Missing: {doc_id} -> {doc['title'][:40]}")
    
    # 保存
    with open(docs_file, 'w', encoding='utf-8') as f:
        json.dump(documents, f, ensure_ascii=False, indent=2)
    
    print(f"\n{'='*60}")
    print(f"✅ Fixed {fixed_count} document paths")
    print(f"⚠️  {missing_count} PDFs still missing (need to re-download)")
    print(f"{'='*60}")
    
    # キャッシュにあるPDFの数を確認
    cached_pdfs = list(CACHE_DIR.glob("*.pdf"))
    print(f"\n📦 Cache directory has {len(cached_pdfs)} PDFs")
    print(f"📄 Documents with valid paths: {fixed_count}")

if __name__ == "__main__":
    fix_pdf_paths()