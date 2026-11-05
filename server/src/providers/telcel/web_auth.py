"""Read Telcel's web-client configuration without executing its JavaScript."""

import base64
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit


def same_origin(url: str, origin: str) -> bool:
    target, source = urlsplit(url), urlsplit(origin)
    return (
        target.scheme == source.scheme == "https"
        and target.hostname == source.hostname
        and (target.port or 443) == (source.port or 443)
        and target.username is None
        and target.password is None
    )


def find_bundle(html: str, page_url: str) -> str:
    candidates: list[str] = []

    class Scripts(HTMLParser):
        def handle_starttag(self, tag, attrs):
            if tag == "script":
                source = dict(attrs).get("src")
                if source:
                    candidates.append(urljoin(page_url, source))

    Scripts().feed(html)
    for url in candidates:
        if same_origin(url, page_url) and re.fullmatch(
            r"/assets/index-[A-Za-z0-9_.-]+\.js", urlsplit(url).path,
        ):
            return url
    raise ValueError("Missing Telcel application bundle.")


def extract_basic_auth(script: str) -> str:
    match = re.search(r'''\bMTL_AUTHORIZATION_BASIC["']?\s*:\s*(["'])([^"'\r\n]+)\1''', script)
    if match is None:
        raise ValueError("Missing Telcel client configuration.")
    value = match[2]
    decoded = base64.b64decode(value, validate=True)
    if b":" not in decoded or not decoded.split(b":", 1)[0] or any(c < 32 or c == 127 for c in decoded):
        raise ValueError("Invalid Telcel client configuration.")
    return value
