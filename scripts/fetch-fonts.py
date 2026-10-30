"""镜像 Google Fonts（中文子集）到 fonts/ 并生成 assets/fonts.css"""
import os, re, ssl, http.client, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_DIR = os.path.join(ROOT, "fonts")
os.makedirs(FONT_DIR, exist_ok=True)

for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    os.environ.pop(k, None)

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
URL = ("https://fonts.googleapis.com/css2"
       "?family=Noto+Serif+SC:wght@500;600"
       "&family=Noto+Sans+SC:wght@400;500;700"
       "&family=Cormorant+Garamond:ital,wght@0,500;1,500"
       "&display=swap")

ctx = ssl.create_default_context()

def get(host, path, tries=8, timeout=30):
    for i in range(tries):
        try:
            c = http.client.HTTPSConnection(host, 443, timeout=timeout, context=ctx)
            c.request("GET", path, headers={"User-Agent": UA})
            r = c.getresponse()
            d = r.read()
            c.close()
            if r.status == 200 and d:
                return d
        except Exception:
            time.sleep(0.5 * (i + 1))
    return None

css = get("fonts.googleapis.com", URL.split("fonts.googleapis.com")[1])
if not css:
    raise SystemExit("取 css 失败")
css = css.decode("utf-8")
print("css bytes", len(css))

KEEP = {"latin", "latin-ext", "chinese-simplified"}
parts = re.split(r"/\*\s*([a-z\-]+)\s*\*/", css)
pairs = [(parts[i], parts[i + 1]) for i in range(1, len(parts) - 1, 2)]
out = ["/* 中文字体镜像：Noto Serif SC / Noto Sans SC / Cormorant Garamond（仅 latin、latin-ext、chinese-simplified 子集） */"]
urls = {}
for name, block in pairs:
    if name not in KEEP:
        continue
    for u in re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", block):
        urls[u] = os.path.join(FONT_DIR, u.rsplit("/", 1)[-1])
    out.append("/* %s */%s" % (name, block))

print("需下载", len(urls), "个字体文件")
ok = fail = 0
for u, path in urls.items():
    if os.path.exists(path) and os.path.getsize(path) > 800:
        ok += 1
        continue
    d = get("fonts.gstatic.com", u.split("fonts.gstatic.com")[1])
    if d and d[:4] == b"wOF2":
        open(path, "wb").write(d)
        ok += 1
    else:
        fail += 1
        print("FAIL", u)

final = "\n".join(out)
final = re.sub(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)",
               lambda m: "url(../fonts/" + m.group(1).rsplit("/", 1)[-1] + ")", final)
open(os.path.join(ROOT, "assets", "fonts.css"), "w", encoding="utf-8").write(final)
print("字体 ok=%d fail=%d，rules=%d" % (ok, fail, final.count("@font-face")))
