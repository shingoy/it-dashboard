"""
政府IT会議データ収集スクリプト（積極収集版）
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

# 積極的な収集設定
MAX_DOCUMENTS_PER_RUN = int(os.getenv('MAX_DOCUMENTS', '100'))  # 10 → 100に増量
MAX_DOCUMENTS_PER_MEETING = int(os.getenv('MAX_PER_MEETING', '10'))  # 1 → 10に増量
DOWNLOAD_TIMEOUT = 30
REQUEST_TIMEOUT = 10

# プリセット会議設定（検証済み + 新規追加）
PRESET_MEETINGS = {
    "digital_agency": {
        "name": "デジタル庁",
        "meetings": [
            {
                "name": "デジタル臨時行政調査会",
                "url": "https://www.digital.go.jp/councils/administrative-research",
                "type": "html_list"
            },
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
                "name": "ベース・レジストリ",
                "url": "https://www.digital.go.jp/policies/base_registry",
                "type": "html_list"
            },
            # 新規追加: デジタル庁の主要ページ
            {
                "name": "デジタル社会推進標準ガイドライン",
                "url": "https://www.digital.go.jp/resources/standard_guidelines/",
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
                "name": "サイバーセキュリティ戦略本部",
                "url": "https://www.nisc.go.jp/council/",
                "type": "html_list"
            },
            # 新規追加: 統合イノベーション戦略推進会議
            {
                "name": "統合イノベーション戦略",
                "url": "https://www8.cao.go.jp/cstp/togo/index.html",
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
            # 新規追加: ICT政策関連
            {
                "name": "情報通信審議会",
                "url": "https://www.soumu.go.jp/main_sosiki/joho_tsusin/policyreports/joho_tsusin/index.html",
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
            # 新規追加: DX関連
            {
                "name": "デジタルトランスフォーメーション",
                "url": "https://www.meti.go.jp/policy/it_policy/dx/index.html",
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

class MeetingCrawler:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Government IT Dashboard Crawler)'
        })
        self.failed_urls = []
        self.docs_cache = self.load_docs_cache()
        self.existing_docs = self.load_existing_docs()
        
    def load_docs_cache(self):
        """既存のドキュメントキャッシュを読み込み"""
        cache_file = DATA_DIR / "docs_cache.json"
        if cache_file.exists():
            with open(cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def load_existing_docs(self):
        """既存の収集済みドキュメントを読み込み"""
        output_file = DATA_DIR / "collected_docs.json"
        if output_file.exists():
            with open(output_file, 'r', encoding='utf-8') as f:
                docs = json.load(f)
                return {doc['id']: doc for doc in docs}
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
                if attempt == retries - 1:
                    # 最後の試行でのみログ
                    print(f"  ⚠️  Failed: {str(e)[:60]}")
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
        print(f"\n📋 {meeting_config['name']}")
        
        response = self.fetch_url(url)
        if not response:
            return []
        
        soup = BeautifulSoup(response.content, 'html.parser')
        documents = []
        
        # PDFリンクを探す
        pdf_links = soup.find_all('a', href=lambda x: x and x.endswith('.pdf'))
        
        if len(pdf_links) == 0:
            print(f"   No PDFs found")
            return []
        
        print(f"   Found {len(pdf_links)} PDFs")
        
        # 最大数を制限
        limit = max_docs if max_docs else MAX_DOCUMENTS_PER_MEETING
        new_count = 0
        
        for link in pdf_links:
            if new_count >= limit:
                break
                
            pdf_url = urljoin(url, link.get('href'))
            
            # 既に収集済みの場合はスキップ
            url_hash = hashlib.md5(pdf_url.encode()).hexdigest()
            if url_hash in self.existing_docs or url_hash in self.docs_cache:
                continue
            
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
            new_count += 1
        
        if new_count > 0:
            print(f"   ✓ {new_count} new documents")
        
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
            return str(pdf_path)
        
        try:
            response = self.session.get(doc['url'], timeout=DOWNLOAD_TIMEOUT, stream=True)
            response.raise_for_status()
            
            # ファイルサイズチェック（20MB以上はスキップ）
            content_length = response.headers.get('content-length')
            if content_length and int(content_length) > 20 * 1024 * 1024:
                print(f"  ⚠️  Too large (>20MB): {doc['title'][:40]}")
                return None
            
            with open(pdf_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            return str(pdf_path)
            
        except Exception as e:
            print(f"  ❌ Download failed: {doc['title'][:30]}")
            self.failed_urls.append({
                "url": doc['url'],
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            })
            return None
    
    def crawl_all(self):
        """全会議を巡回（積極収集）"""
        all_new_documents = []
        download_count = 0
        
        start_time = time.time()
        max_runtime = 4 * 60  # 4分で強制終了
        
        print(f"\n{'='*60}")
        print(f"🚀 Aggressive Crawling Strategy")
        print(f"   Max per meeting: {MAX_DOCUMENTS_PER_MEETING}")
        print(f"   Total limit: {MAX_DOCUMENTS_PER_RUN}")
        print(f"   Already collected: {len(self.existing_docs)}")
        print(f"{'='*60}")
        
        for agency_id, agency_config in PRESET_MEETINGS.items():
            # タイムアウトチェック
            if time.time() - start_time > max_runtime:
                print(f"\n⏱️  Runtime limit reached, stopping")
                break
            
            print(f"\n🏛️  {agency_config['name']}")
            
            for meeting in agency_config['meetings']:
                # タイムアウトチェック
                if time.time() - start_time > max_runtime:
                    break
                
                # 全体の最大ダウンロード数チェック
                if download_count >= MAX_DOCUMENTS_PER_RUN:
                    print(f"\n⚠️  Reached run limit ({MAX_DOCUMENTS_PER_RUN})")
                    break
                
                meeting['agency'] = agency_config['name']
                documents = self.parse_meeting_list(meeting)
                
                # PDFをダウンロード
                for doc in documents:
                    if download_count >= MAX_DOCUMENTS_PER_RUN:
                        break
                    
                    pdf_path = self.download_pdf(doc)
                    if pdf_path:
                        doc['pdf_path'] = pdf_path
                        all_new_documents.append(doc)
                        self.docs_cache[doc['id']] = doc
                        download_count += 1
                        
                        if download_count % 10 == 0:
                            print(f"\n📊 Progress: {download_count}/{MAX_DOCUMENTS_PER_RUN}")
                
                time.sleep(0.3)  # レート制限対策
        
        elapsed = time.time() - start_time
        print(f"\n{'='*60}")
        print(f"⏱️  Time: {elapsed:.1f}s")
        print(f"📚 New documents: {len(all_new_documents)}")
        print(f"📚 Total documents: {len(self.existing_docs) + len(all_new_documents)}")
        
        return all_new_documents
    
    def save_results(self, new_documents):
        """収集結果を保存（既存データに追加）"""
        # 既存のドキュメントと新規を統合
        all_documents = list(self.existing_docs.values()) + new_documents
        
        output_file = DATA_DIR / "collected_docs.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(all_documents, f, ensure_ascii=False, indent=2)
        
        print(f"\n✅ Saved {len(all_documents)} total documents")
        print(f"   ({len(new_documents)} new + {len(self.existing_docs)} existing)")
        
        if self.failed_urls:
            with open(FAILED_LOG, 'w', encoding='utf-8') as f:
                json.dump(self.failed_urls, f, ensure_ascii=False, indent=2)
            print(f"⚠️  {len(self.failed_urls)} failed URLs")
        
        self.save_docs_cache()

def main():
    print("🚀 Government IT Document Crawler (Aggressive Mode)")
    print(f"   Max per run: {MAX_DOCUMENTS_PER_RUN}")
    print(f"   Max per meeting: {MAX_DOCUMENTS_PER_MEETING}")
    
    crawler = MeetingCrawler()
    new_documents = crawler.crawl_all()
    crawler.save_results(new_documents)
    
    print("\n" + "="*60)
    print(f"✨ Crawling complete!")
    print("="*60)

if __name__ == "__main__":
    main()