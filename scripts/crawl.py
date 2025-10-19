"""
政府IT会議データ収集スクリプト（タイムアウト対策版）
"""

import json
import os
import hashlib
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin
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

# プリセット会議設定（全会議）
# プリセット会議設定（検証済みURL）
PRESET_MEETINGS = {
    "digital_agency": {
        "name": "デジタル庁",
        "meetings": [
            {
                "name": "デジタル社会推進会議",
                "url": "https://www.digital.go.jp/councils/social-promotion",
                "type": "html_list"
            },
            {
                "name": "データ戦略推進ワーキンググループ",
                "url": "https://www.digital.go.jp/councils/data-strategy-wg",
                "type": "html_list"
            },
            {
                "name": "マイナンバー制度及び国と地方のデジタル基盤抜本改善ワーキンググループ",
                "url": "https://www.digital.go.jp/councils/my-number-improvement",
                "type": "html_list"
            },
            {
                "name": "デジタル臨時行政調査会",
                "url": "https://www.digital.go.jp/councils/administrative-research",
                "type": "html_list"
            },
            {
                "name": "ベース・レジストリ",
                "url": "https://www.digital.go.jp/policies/base_registry",
                "type": "html_list"
            },
            {
                "name": "ガバメントクラウド",
                "url": "https://www.digital.go.jp/policies/gov-cloud",
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
            {
                "name": "高度情報通信ネットワーク社会推進戦略本部",
                "url": "https://www.kantei.go.jp/jp/singi/it2/",
                "type": "html_list"
            },
            {
                "name": "サイバーセキュリティ戦略本部",
                "url": "https://www.nisc.go.jp/council/",
                "type": "html_list"
            },
        ]
    },
    "mic": {
        "name": "総務省",
        "meetings": [
            {
                "name": "デジタル・ガバメント",
                "url": "https://www.soumu.go.jp/menu_seisaku/ictseisaku/ictriyou/",
                "type": "html_list"
            },
        ]
    },
    "meti": {
        "name": "経済産業省",
        "meetings": [
            {
                "name": "デジタル産業の創出に向けた研究会",
                "url": "https://www.meti.go.jp/shingikai/mono_info_service/digital_sangyo/index.html",
                "type": "html_list"
            },
        ]
    },
    "mhlw": {
        "name": "厚生労働省",
        "meetings": [
            {
                "name": "医療DX令和ビジョン2030",
                "url": "https://www.mhlw.go.jp/stf/newpage_28422.html",
                "type": "html_list"
            },
        ]
    },
    "mext": {
        "name": "文部科学省",
        "meetings": [
            {
                "name": "GIGAスクール構想",
                "url": "https://www.mext.go.jp/a_menu/shotou/zyouhou/detail/mext_00002.html",
                "type": "html_list"
            },
        ]
    },
    "ppc": {
        "name": "個人情報保護委員会",
        "meetings": [
            {
                "name": "個人情報保護委員会",
                "url": "https://www.ppc.go.jp/aboutus/commission/",
                "type": "html_list"
            },
        ]
    },
    "other": {
        "name": "その他",
        "meetings": [
            {
                "name": "CIO連絡会議",
                "url": "https://cio.go.jp/",
                "type": "html_list"
            },
        ]
    },
}

# 制限設定
MAX_DOCUMENTS_PER_RUN = int(os.getenv('MAX_DOCUMENTS', '10'))  # 1回の実行で10件（全会議カバー）
MAX_DOCUMENTS_PER_MEETING = 1  # 各会議から1件ずつ（より公平に）
DOWNLOAD_TIMEOUT = 30
REQUEST_TIMEOUT = 10

class MeetingCrawler:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Government IT Dashboard Crawler)'
        })
        self.failed_urls = []
        self.docs_cache = self.load_docs_cache()
        
    def load_docs_cache(self):
        """既存のドキュメントキャッシュを読み込み"""
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
    
    def fetch_url(self, url, retries=2):
        """URLからコンテンツを取得（タイムアウト付き）"""
        for attempt in range(retries):
            try:
                response = self.session.get(url, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                return response
            except Exception as e:
                print(f"  ⚠️  Attempt {attempt + 1} failed: {str(e)[:50]}")
                if attempt == retries - 1:
                    self.failed_urls.append({
                        "url": url,
                        "error": str(e),
                        "timestamp": datetime.now().isoformat()
                    })
                    return None
                time.sleep(1)
        return None
    
    def parse_meeting_list(self, meeting_config, max_docs=None):
        """会議ページから議事録・資料のリストを抽出"""
        url = meeting_config['url']
        print(f"\n📋 Crawling: {meeting_config['name']}")
        print(f"   URL: {url}")
        
        response = self.fetch_url(url)
        if not response:
            return []
        
        soup = BeautifulSoup(response.content, 'html.parser')
        documents = []
        
        # PDFリンクを探す
        pdf_links = soup.find_all('a', href=lambda x: x and x.endswith('.pdf'))
        
        print(f"   Found {len(pdf_links)} PDF links")
        
        # 最大数を制限（指定がなければ全て）
        limit = max_docs if max_docs else len(pdf_links)
        
        for link in pdf_links[:limit]:
            pdf_url = urljoin(url, link.get('href'))
            
            # 既にキャッシュにある場合はスキップ
            url_hash = hashlib.md5(pdf_url.encode()).hexdigest()
            if url_hash in self.docs_cache:
                continue  # キャッシュ済みはカウントしない
            
            # タイトルを取得
            title = link.get_text(strip=True)
            if not title:
                parent = link.find_parent(['li', 'div', 'td'])
                if parent:
                    title = parent.get_text(strip=True)[:100]
            
            # 日付を推測
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
            print(f"  ✓ New: {title[:60]}...")
            
            # 見つかったら早めに終了（各会議から少しずつ）
            if len(documents) >= MAX_DOCUMENTS_PER_MEETING:
                break
        
        return documents
    
    def extract_date_from_element(self, element):
        """要素周辺から日付を抽出"""
        import re
        
        parent = element.find_parent(['li', 'div', 'td', 'tr'])
        if parent:
            text = parent.get_text()
            
            # 令和X年Y月Z日
            match = re.search(r'令和(\d+)年(\d+)月(\d+)日', text)
            if match:
                year = 2018 + int(match.group(1))
                month = int(match.group(2))
                day = int(match.group(3))
                return f"{year}-{month:02d}-{day:02d}"
            
            # YYYY年MM月DD日
            match = re.search(r'(\d{4})年(\d{1,2})月(\d{1,2})日', text)
            if match:
                return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
            
            # YYYY/MM/DD or YYYY-MM-DD
            match = re.search(r'(\d{4})[/-](\d{1,2})[/-](\d{1,2})', text)
            if match:
                return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
        
        return datetime.now().strftime('%Y-%m-%d')
    
    def download_pdf(self, doc):
        """PDFをダウンロード（タイムアウト付き）"""
        pdf_path = CACHE_DIR / f"{doc['id']}.pdf"
        
        # 既にダウンロード済みならスキップ
        if pdf_path.exists():
            print(f"  ⏭️  Already exists: {pdf_path.name}")
            return str(pdf_path)
        
        try:
            print(f"  ⬇️  Downloading: {doc['title'][:40]}...")
            response = self.session.get(doc['url'], timeout=DOWNLOAD_TIMEOUT, stream=True)
            response.raise_for_status()
            
            # ファイルサイズチェック（10MB以上はスキップ）
            content_length = response.headers.get('content-length')
            if content_length and int(content_length) > 10 * 1024 * 1024:
                print(f"  ⚠️  File too large (>10MB), skipping")
                return None
            
            with open(pdf_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            print(f"  💾 Downloaded: {pdf_path.name}")
            return str(pdf_path)
            
        except Exception as e:
            print(f"  ❌ Failed to download: {str(e)[:50]}")
            self.failed_urls.append({
                "url": doc['url'],
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            })
            return None
    
    def crawl_all(self):
        """全会議を巡回（各会議から少しずつ収集）"""
        all_documents = []
        download_count = 0
        
        start_time = time.time()
        max_runtime = 4 * 60  # 4分で強制終了
        
        print(f"\n📊 Strategy: Collect up to {MAX_DOCUMENTS_PER_MEETING} docs from each meeting")
        print(f"   Total limit: {MAX_DOCUMENTS_PER_RUN} documents per run")
        
        for agency_id, agency_config in PRESET_MEETINGS.items():
            # タイムアウトチェック
            if time.time() - start_time > max_runtime:
                print(f"\n⏱️  Runtime limit reached ({max_runtime}s), stopping")
                break
            
            print(f"\n{'='*60}")
            print(f"🏛️  Agency: {agency_config['name']}")
            print(f"{'='*60}")
            
            for meeting in agency_config['meetings']:
                # タイムアウトチェック
                if time.time() - start_time > max_runtime:
                    break
                
                # 全体の最大ダウンロード数チェック
                if download_count >= MAX_DOCUMENTS_PER_RUN:
                    print(f"\n⚠️  Reached run limit ({MAX_DOCUMENTS_PER_RUN}), stopping")
                    return all_documents
                
                meeting['agency'] = agency_config['name']
                documents = self.parse_meeting_list(meeting)
                
                # PDFをダウンロード（各会議から少しずつ）
                downloaded_from_meeting = 0
                for doc in documents:
                    if download_count >= MAX_DOCUMENTS_PER_RUN:
                        break
                    if downloaded_from_meeting >= MAX_DOCUMENTS_PER_MEETING:
                        break
                    
                    pdf_path = self.download_pdf(doc)
                    if pdf_path:
                        doc['pdf_path'] = pdf_path
                        all_documents.append(doc)
                        self.docs_cache[doc['id']] = doc
                        download_count += 1
                        downloaded_from_meeting += 1
                        print(f"  📊 Total progress: {download_count}/{MAX_DOCUMENTS_PER_RUN}")
                
                time.sleep(0.5)  # レート制限対策
        
        elapsed = time.time() - start_time
        print(f"\n⏱️  Total time: {elapsed:.1f}s")
        print(f"📚 Collected from {len(set(d['meeting'] for d in all_documents))} different meetings")
        
        return all_documents
    
    def save_results(self, documents):
        """収集結果を保存"""
        output_file = DATA_DIR / "collected_docs.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(documents, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ Saved {len(documents)} documents to {output_file}")
        
        if self.failed_urls:
            with open(FAILED_LOG, 'w', encoding='utf-8') as f:
                json.dump(self.failed_urls, f, ensure_ascii=False, indent=2)
            print(f"⚠️  {len(self.failed_urls)} failed URLs logged")
        
        self.save_docs_cache()

def main():
    print("🚀 Starting Government IT Meeting Crawler")
    print(f"   Max documents per run: {MAX_DOCUMENTS_PER_RUN}")
    print(f"   Max per meeting: {MAX_DOCUMENTS_PER_MEETING}")
    print(f"   Download timeout: {DOWNLOAD_TIMEOUT}s")
    print("="*60)
    
    crawler = MeetingCrawler()
    documents = crawler.crawl_all()
    crawler.save_results(documents)
    
    print("\n" + "="*60)
    print(f"✨ Crawling complete! Collected {len(documents)} documents")
    print("="*60)

if __name__ == "__main__":
    main()