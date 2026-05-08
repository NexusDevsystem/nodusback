import sys
import json
import logging
import re
from scrapling import StealthyFetcher

# Disable logging to keep stdout clean for JSON
logging.basicConfig(level=logging.ERROR)

def scrape_x(url):
    try:
        # Use StealthyFetcher for better bypass
        fetcher = StealthyFetcher()
        page = fetcher.fetch(url, headless=True)
        
        if not page:
            return {"error": "Failed to fetch page"}

        # 1. Try Meta Tags first (fastest)
        name = page.css('meta[property="og:title"]::attr(content)').get()
        if name:
            name = name.split(' (')[0]
            
        avatar = page.css('meta[property="og:image"]::attr(content)').get()
        if not avatar:
            avatar = page.css('meta[name="twitter:image"]::attr(content)').get()
            
        description = page.css('meta[property="og:description"]::attr(content)').get()

        # 2. Rendered Selectors Fallback (if meta tags are missing or generic)
        if not name or name == "X" or name == "Twitter":
            name = page.css('[data-testid="UserName"] span::text').get()
        
        if not avatar or 'default_profile' in avatar:
            # Try finding the large profile image in the rendered page
            avatar = page.css('[data-testid="UserAvatar-Container"] img::attr(src)').get()
            
        if not description:
            description = page.css('[data-testid="UserDescription"]::text').get()

        # 3. Stats (Followers)
        followers = None
        if description:
            f_match = re.search(r'([\d.,]+[KMB]?)\s*(?:followers|seguidores|inscritos|subscribers)', description, re.I)
            if f_match:
                followers = f_match.group(1)
        
        if not followers:
            page_text = page.text
            f_match = re.search(r'([\d.,]+[KMB]?)\s*(?:followers|seguidores|inscritos|subscribers)', page_text, re.I)
            if f_match:
                followers = f_match.group(1)
        
        # Clean avatar
        if avatar and '_normal' in avatar:
            avatar = avatar.replace('_normal', '_400x400')

        return {
            "name": name,
            "avatarUrl": avatar,
            "description": description,
            "followers": followers,
            "status": "success"
        }
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No URL provided"}))
        sys.exit(1)
        
    url = sys.argv[1]
    result = scrape_x(url)
    print(json.dumps(result))
