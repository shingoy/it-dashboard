"""
政府IT会議データ収集スクリプト
各省庁のサイトから会議情報・PDF・HTMLを収集
"""

import json
import os
import hashlib
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

# 設定
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = DATA_DIR / "cache"
OUTPUT_DIR = BASE_DIR / "public"
FAILED_LOG = DATA_DIR / "failed_urls.json"

# ディレクトリ作成
DATA_DIR.mkdir(exist_ok=True)
CACHE_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# プリセット会議設定
PRESET_MEETINGS = {
    "digital_agency": {
        "name": "デジタル庁",
        "meetings": [
            {
                "name": "デジタル社会推進会議",
                "url": "https://www.digital.go.jp/councils/",
                "type": "html_list"
            },
            {
                "name": "データ戦略推進ワーキンググループ",
                "url": "https://www.digital.go.jp/councils/data-strategy-wg/",
                "type": "html_list"
            },
        ]
    },
    "cabinet_office": {
        "name": "内閣府・内閣官房",
        "meetings": [
            {
                "name": "AI戦略会議",
                "url": "https://www8.cao.go.jp/cstp/ai/",
                "type": "html_list"
            },
        ]
    },
    "mic": {
        "name": "総務省",
        "meetings": [
            {
                "name": "デジタル・ガバメント推進",
                "url": "https://www.soumu.go.jp/menu_sosiki/",
                "type": "html_list"
            },
        ]
    },
}

class MeetingCrawler:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Government IT Dashboard Crawler)'
        })
        self.failed_urls = []
        self.docs_cache = self.load_docs_cache()
        
    def load_docs_cache(self):
        """既存のドキュメントキャッシュを読み込み（重複回避）"""
        cache_file = DATA_DIR / "docs_cache.json"
        if cache_file.exists():
            with open(cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def save_docs_cache(self):
        """ドキュメントキャッシュを保存"""
        cache_file = DATA_DIR / "docs_cache.json"
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(self.docs_cache, f, ensure_ascii=False, indent=2)
    
    def fetch_url(self, url, retries=3):
        """URLからコンテンツを取得"""
        for attempt in range(retries):
            try:
                response = self.session.get(url, timeout=30)
                response.raise_for_status()
                return response
            except Exception as e:
                print(f"  ⚠️  Attempt {attempt + 1} failed: {url}")
                if attempt == retries - 1:
                    self.failed_urls.append({
                        "url": url,
                        "error": str(e),
                        "timestamp": datetime.now().isoformat()
                    })
                    return None
                time.sleep(2 ** attempt)
        return None
    
    def parse_meeting_list(self, meeting_config):
        """会議ページから議事録・資料のリストを抽出"""
        url = meeting_config['url']
        print(f"\n📋 Crawling: {meeting_config['name']}")
        print(f"   URL: {url}")
        
        response = self.fetch_url(url)
        if not response:
            return []
        
        soup = BeautifulSoup(response.content, 'html.parser')
        documents = []
        
        # PDFリンクを探す（一般的なパターン）
        pdf_links = soup.find_all('a', href=lambda x: x and x.endswith('.pdf'))
        
        for link in pdf_links:
            pdf_url = urljoin(url, link.get('href'))
            
            # 既にキャッシュにある場合はスキップ
            url_hash = hashlib.md5(pdf_url.encode()).hexdigest()
            if url_hash in self.docs_cache:
                continue
            
            # タイトルを取得
            title = link.get_text(strip=True)
            if not title:
                # 親要素からタイトルを探す
                parent = link.find_parent(['li', 'div', 'td'])
                if parent:
                    title = parent.get_text(strip=True)[:100]
            
            # 日付を推測（同じ要素内から）
            date_str = self.extract_date_from_element(link)
            
            doc = {
                "id": url_hash,
                "meeting": meeting_config['name'],
                "agency": meeting_config.get('agency', ''),
                "title": title,
                "url": pdf_url,
                "file_type": "pdf",
                "date": date_str,
                "collected_at": datetime.now().isoformat()
            }
            
            documents.append(doc)
            print(f"  ✓ Found: {title[:60]}...")
        
        return documents
    
    def extract_date_from_element(self, element):
        """要素周辺からYYYY-MM-DD形式の日付を抽出"""
        import re
        
        # 親要素のテキストから日付パターンを探す
        parent = element.find_parent(['li', 'div', 'td', 'tr'])
        if parent:
            text = parent.get_text()
            
            # パターン1: 令和X年Y月Z日
            match = re.search(r'令和(\d+)年(\d+)月(\d+)日', text)
            if match:
                year = 2018 + int(match.group(1))
                month = int(match.group(2))
                day = int(match.group(3))
                return f"{year}-{month:02d}-{day:02d}"
            
            # パターン2: YYYY年MM月DD日
            match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', text)
            if match:
                return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
            
            # パターン3: YYYY/MM/DD or YYYY-MM-DD
            match = re.search(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})', text)
            if match:
                return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
        
        return datetime.now().strftime('%Y-%m-%d')
    
    def download_pdf(self, doc):
        """PDFをダウンロード"""
        pdf_path = CACHE_DIR / f"{doc['id']}.pdf"
        
        # 既にダウンロード済みならスキップ
        if pdf_path.exists():
            return str(pdf_path)
        
        response = self.fetch_url(doc['url'])
        if not response:
            return None
        
        try:
            with open(pdf_path, 'wb') as f:
                f.write(response.content)
            print(f"  💾 Downloaded: {pdf_path.name}")
            return str(pdf_path)
        except Exception as e:
            print(f"  ❌ Failed to save PDF: {e}")
            return None
    
    def crawl_all(self):
        """全会議を巡回"""
        all_documents = []
        
        for agency_id, agency_config in PRESET_MEETINGS.items():
            print(f"\n{'='*60}")
            print(f"🏛️  Agency: {agency_config['name']}")
            print(f"{'='*60}")
            
            for meeting in agency_config['meetings']:
                meeting['agency'] = agency_config['name']
                documents = self.parse_meeting_list(meeting)
                
                # PDFをダウンロード
                for doc in documents:
                    pdf_path = self.download_pdf(doc)
                    if pdf_path:
                        doc['pdf_path'] = pdf_path
                        all_documents.append(doc)
                        # キャッシュに追加
                        self.docs_cache[doc['id']] = doc

                    # テスト用：最初の5ファイルだけ
                    if len(all_documents) >= 5:
                        print("⚠️  Test mode: stopping at 5 files")
                        return all_documents

                    # レート制限対策
                    time.sleep(1)
        
        return all_documents
    
    def save_results(self, documents):
        """収集結果を保存"""
        output_file = DATA_DIR / "collected_docs.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(documents, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ Saved {len(documents)} documents to {output_file}")
        
        # 失敗URLを保存
        if self.failed_urls:
            with open(FAILED_LOG, 'w', encoding='utf-8') as f:
                json.dump(self.failed_urls, f, ensure_ascii=False, indent=2)
            print(f"⚠️  {len(self.failed_urls)} failed URLs logged to {FAILED_LOG}")
        
        # キャッシュを保存
        self.save_docs_cache()

def main():
    print("🚀 Starting Government IT Meeting Crawler")
    print("="*60)
    
    crawler = MeetingCrawler()
    documents = crawler.crawl_all()
    crawler.save_results(documents)
    
    print("\n" + "="*60)
    print(f"✨ Crawling complete! Collected {len(documents)} documents")
    print("="*60)

if __name__ == "__main__":
    main()
