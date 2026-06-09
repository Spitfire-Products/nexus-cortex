#!/usr/bin/env python3
"""
Complete XAI Documentation Scraper with Selenium
Captures JavaScript-rendered content including code examples
"""

import os
import sys
import time
import re
from urllib.parse import urlparse
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException

def setup_driver():
    """Setup headless Chrome driver"""
    chrome_options = Options()
    chrome_options.add_argument('--headless')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('--window-size=1920,1080')
    chrome_options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')

    driver = webdriver.Chrome(options=chrome_options)
    driver.set_page_load_timeout(30)
    return driver

def wait_for_content(driver, timeout=10):
    """Wait for main content to load"""
    try:
        # Wait for main content area
        wait = WebDriverWait(driver, timeout)
        wait.until(EC.presence_of_element_located((By.TAG_NAME, "main")))

        # Additional wait for dynamic content
        time.sleep(2)

        # Scroll to trigger lazy loading
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(1)
        driver.execute_script("window.scrollTo(0, 0)")
        time.sleep(1)

        return True
    except TimeoutException:
        print("  Warning: Timeout waiting for content")
        return False

def expand_all_sections(driver):
    """Try to expand any collapsible sections"""
    try:
        # Common expand button patterns
        expand_selectors = [
            "button[aria-expanded='false']",
            "[class*='expand']",
            "[class*='toggle']",
            "summary"  # For <details> elements
        ]

        for selector in expand_selectors:
            try:
                elements = driver.find_elements(By.CSS_SELECTOR, selector)
                for element in elements[:20]:  # Limit to avoid infinite loops
                    try:
                        if element.is_displayed():
                            element.click()
                            time.sleep(0.3)
                    except:
                        pass
            except:
                pass
    except Exception as e:
        print(f"  Warning: Error expanding sections: {e}")

def fetch_page_with_selenium(url, output_dir='xai_docs_complete'):
    """
    Fetch page using Selenium and extract content with BeautifulSoup
    """
    driver = None
    try:
        print(f"\nFetching: {url}")

        driver = setup_driver()
        driver.get(url)

        # Wait for content to load
        wait_for_content(driver)

        # Try to expand collapsible sections
        expand_all_sections(driver)

        # Get fully rendered HTML
        html = driver.page_source

        # Parse with BeautifulSoup
        soup = BeautifulSoup(html, 'html.parser')

        # Remove navigation, footers, and sidebars
        for element in soup(['nav', 'footer', 'aside', 'header', 'script', 'style']):
            element.decompose()

        # Extract main content
        main_content = soup.find('main') or soup.find('article') or soup.body
        if not main_content:
            main_content = soup

        # Convert to Markdown
        markdown = []

        # Add title
        title_tag = soup.find('h1')
        if title_tag:
            markdown.append(f"# {title_tag.get_text(strip=True)}")
            markdown.append('')

        # Process all elements in order
        for element in main_content.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'pre', 'table', 'blockquote']):

            # Headings
            if element.name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                level = int(element.name[1])
                text = element.get_text(strip=True)
                if text:  # Skip empty headings
                    markdown.append(f"{'#' * level} {text}")
                    markdown.append('')

            # Paragraphs
            elif element.name == 'p':
                text = element.get_text(strip=True)
                if text and len(text) > 1:  # Skip nearly empty paragraphs
                    # Preserve inline code
                    for code in element.find_all('code'):
                        code_text = code.get_text()
                        code.replace_with(f"`{code_text}`")

                    # Get text with inline formatting
                    text = element.get_text(strip=False)
                    text = re.sub(r'\s+', ' ', text).strip()
                    if text:
                        markdown.append(text)
                        markdown.append('')

            # Unordered lists
            elif element.name == 'ul':
                # Only process if not already processed as part of parent
                if not any(element in parent.find_all('ul') for parent in element.find_parents(['ul', 'ol'])):
                    for li in element.find_all('li', recursive=False):
                        text = li.get_text(strip=True)
                        if text:
                            markdown.append(f"- {text}")
                    markdown.append('')

            # Ordered lists
            elif element.name == 'ol':
                if not any(element in parent.find_all('ol') for parent in element.find_parents(['ul', 'ol'])):
                    for idx, li in enumerate(element.find_all('li', recursive=False), 1):
                        text = li.get_text(strip=True)
                        if text:
                            markdown.append(f"{idx}. {text}")
                    markdown.append('')

            # Code blocks
            elif element.name == 'pre':
                code = element.find('code')
                if code:
                    # Try to get language from class
                    lang = ''
                    if code.get('class'):
                        for cls in code.get('class'):
                            if 'language-' in cls:
                                lang = cls.replace('language-', '')
                                break
                            elif cls in ['python', 'javascript', 'bash', 'json', 'typescript', 'jsx', 'tsx']:
                                lang = cls
                                break

                    content = code.get_text()
                    markdown.append(f"```{lang}")
                    markdown.append(content.rstrip())
                    markdown.append('```')
                    markdown.append('')

            # Tables
            elif element.name == 'table':
                rows = []
                for tr in element.find_all('tr'):
                    cells = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
                    if cells:
                        rows.append('| ' + ' | '.join(cells) + ' |')

                if rows:
                    markdown.append(rows[0])
                    # Add separator row
                    num_cols = len(rows[0].split('|')) - 2
                    markdown.append('|' + '---|' * num_cols)
                    markdown.extend(rows[1:])
                    markdown.append('')

            # Blockquotes
            elif element.name == 'blockquote':
                text = element.get_text(strip=True)
                if text:
                    for line in text.split('\n'):
                        if line.strip():
                            markdown.append(f"> {line.strip()}")
                    markdown.append('')

        # Join and clean up
        content_md = '\n'.join(markdown).strip()

        # Remove excessive blank lines
        content_md = re.sub(r'\n{3,}', '\n\n', content_md)

        # Save to file
        os.makedirs(output_dir, exist_ok=True)
        filename = urlparse(url).path.strip('/').replace('/', '_') or 'overview'
        filepath = os.path.join(output_dir, f"{filename}.md")

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(f"# {url}\n\n")
            f.write(f"---\n\n")
            f.write(content_md)

        print(f"  ✓ Saved to {filepath} ({len(content_md)} chars)")
        return content_md

    except Exception as e:
        print(f"  ✗ Error: {e}")
        return None

    finally:
        if driver:
            driver.quit()

def main():
    output_dir = sys.argv[1] if len(sys.argv) > 1 else 'xai_docs_complete'

    # Comprehensive list of XAI documentation pages
    urls = [
        # Getting Started
        "https://docs.x.ai/docs/overview",
        "https://docs.x.ai/docs/introduction",
        "https://docs.x.ai/docs/tutorial",
        "https://docs.x.ai/docs/models",
        "https://docs.x.ai/docs/release-notes",

        # Models
        "https://docs.x.ai/docs/models/grok-4-0709",
        "https://docs.x.ai/docs/models/grok-4-fast",
        "https://docs.x.ai/docs/models/grok-3",
        "https://docs.x.ai/docs/models/grok-2-1212",

        # Key Information
        "https://docs.x.ai/docs/key-information/billing",
        "https://docs.x.ai/docs/key-information/consumption-and-rate-limits",
        "https://docs.x.ai/docs/key-information/regions",
        "https://docs.x.ai/docs/key-information/collections",
        "https://docs.x.ai/docs/key-information/using-management-api",
        "https://docs.x.ai/docs/key-information/usage-explorer",
        "https://docs.x.ai/docs/key-information/debugging",

        # Guides
        "https://docs.x.ai/docs/guides/responses-api",
        "https://docs.x.ai/docs/guides/chat",
        "https://docs.x.ai/docs/guides/reasoning",
        "https://docs.x.ai/docs/guides/function-calling",
        "https://docs.x.ai/docs/guides/tools/overview",
        "https://docs.x.ai/docs/guides/tools/search-tools",
        "https://docs.x.ai/docs/guides/live-search",
        "https://docs.x.ai/docs/guides/using-collections",
        "https://docs.x.ai/docs/guides/image-understanding",
        "https://docs.x.ai/docs/guides/image-generations",
        "https://docs.x.ai/docs/guides/streaming-response",
        "https://docs.x.ai/docs/guides/deferred-chat-completions",
        "https://docs.x.ai/docs/guides/async",
        "https://docs.x.ai/docs/guides/structured-outputs",
        "https://docs.x.ai/docs/guides/fingerprint",
        "https://docs.x.ai/docs/guides/migration",
        "https://docs.x.ai/docs/guides/grok-code-prompt-engineering",
        "https://docs.x.ai/docs/guides/use-with-code-editors",

        # API Reference
        "https://docs.x.ai/docs/api-reference",
        "https://docs.x.ai/docs/management-api",
    ]

    print(f"Starting comprehensive XAI documentation scrape...")
    print(f"Total pages: {len(urls)}")
    print(f"Output directory: {output_dir}")

    successful = 0
    failed = 0

    for idx, url in enumerate(urls, 1):
        print(f"\n[{idx}/{len(urls)}]", end=' ')
        result = fetch_page_with_selenium(url, output_dir)

        if result:
            successful += 1
        else:
            failed += 1

        # Rate limiting
        time.sleep(2)

    print(f"\n\n{'='*60}")
    print(f"Scraping complete!")
    print(f"Successful: {successful}/{len(urls)}")
    print(f"Failed: {failed}/{len(urls)}")
    print(f"Output directory: {output_dir}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
