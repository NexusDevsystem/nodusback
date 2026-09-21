import sys
import json
import logging
import re
from scrapling import StealthyFetcher

# Disable logging to keep stdout clean for JSON
logging.basicConfig(level=logging.ERROR)

def scrape_x(url):
    try:
        # Use StealthyFetcher with longer wait
        fetcher = StealthyFetcher()
        page = fetcher.fetch(url, headless=True, network_idle=True, timeout=20000)

        if not page:
            return {"error": "Failed to fetch page"}

        full_html = str(page)

        # 1. Try to find the JSON data in the script tags (The most reliable source)
        # Patterns for X's initial state
        # Usually window.__INITIAL_STATE__ or similar
        profile_data = {}

        # Search for profile image pattern in the whole HTML as a fallback
        # Profile images on X follow a pattern like pbs.twimg.com/profile_images/
        avatar_match = re.search(r'https://pbs\.twimg\.com/profile_images/[\d]+/[^"\'\s]+', full_html)
        avatar = avatar_match.group(0) if avatar_match else None

        # Clean up avatar
        if avatar:
            # Remove any trailing characters like " or '
            avatar = avatar.split('"')[0].split("'")[0]
            if '_normal' in avatar:
                avatar = avatar.replace('_normal', '_400x400')
            elif '_200x200' in avatar:
                avatar = avatar.replace('_200x200', '_400x400')

        # 2. Extract name and description from meta tags or selectors
        name = page.css('meta[property="og:title"]::attr(content)').get()
        if name:
            name = name.split(' (')[0]
        else:
            name_el = page.css('[data-testid="UserName"] span::text').getall()
            if name_el:
                name = " ".join(name_el).strip()
            
        description = page.css('meta[property="og:description"]::attr(content)').get()
        if not description:
            description_els = page.css('[data-testid="UserDescription"] ::text').getall()
            if description_els:
                description = " ".join(description_els).strip()

        # 3. Stats (Followers)
        followers = None
        # Try to find followers in the text specifically
        # Pattern: "X Followers" or "X Seguidores"
        f_match = re.search(r'([\d.,]+[KMB]?)\s*(?:Followers|Seguidores)', full_html, re.I)
        if f_match:
            followers = f_match.group(1)
        
        # If still no followers, try CSS selectors
        if not followers:
            followers_el = page.css('a[href$="/verified_followers"] span span::text').get() or \
                           page.css('a[href$="/followers"] span span::text').get()
            if followers_el:
                followers = followers_el.strip()

        # 4. Final check for avatar if still null or default
        if not avatar or 'default_profile' in avatar:
            avatar = page.css('a[href$="/photo"] img::attr(src)').get() or \
                     page.css('[data-testid="UserAvatar-Container"] img::attr(src)').get()

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
