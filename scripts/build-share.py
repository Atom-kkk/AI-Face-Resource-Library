"""生成微信分享用的离线精简版：不含文档、不含 4.5GB 原图，下载按钮改为本地 400×500 预览图。"""
import os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(ROOT), "ai-face-library-share")
NAME = "AI-Face-Library"
ZIP = os.path.join(os.path.dirname(ROOT), "AI模特脸参考库-离线版.zip")

if os.path.isdir(OUT):
    shutil.rmtree(OUT)
os.makedirs(os.path.join(OUT, "assets"))
os.makedirs(os.path.join(OUT, "fonts"))

# 只要站点本体：无 README / LICENSE / NOTICE / .github / scripts / assets/full
shutil.copy2(os.path.join(ROOT, "index.html"), OUT)
for f in ("app.js", "data.js", "style.css", "fonts.css"):
    shutil.copy2(os.path.join(ROOT, "assets", f), os.path.join(OUT, "assets", f))
for f in os.listdir(os.path.join(ROOT, "fonts")):
    shutil.copy2(os.path.join(ROOT, "fonts", f), os.path.join(OUT, "fonts", f))
print("拷贝缩略图…")
shutil.copytree(os.path.join(ROOT, "assets", "thumb"), os.path.join(OUT, "assets", "thumb"))

# ---------- 改 app.js ----------
p = os.path.join(OUT, "assets", "app.js")
s = open(p, encoding="utf-8").read()

def rep(old, new):
    global s
    assert old in s, "未找到：" + old[:60]
    s = s.replace(old, new)

# 1) 去掉「探测原图 / 回退原站」整段，换成固定的本地预览图地址
start = s.index("  var REMOTE_BASE = ")
end = s.index("  function lenName(l)")
s = s[:start] + '''  function fullURLOf(it) {
    /* 离线精简版：不含原尺寸 PNG，内置图直接给本地 400×500 WebP；自己上传的图给原文件 */
    if (it.local) return it.full;
    return it.thumb;
  }

''' + s[end:]

rep("    probeFull().then(function () {\n      setSection(\"face\");",
    "    (function () {\n      setSection(\"face\");")
rep('''      mergeLocal().then(function () {
        buildFilters();
        applyFilters();
      });
    });''',
    '''      mergeLocal().then(function () {
        buildFilters();
        applyFilters();
      });
    })();''')

# 3) 卡片下载按钮
rep('''    dl.setAttribute("download", "face-" + it.id + ".png");
    dl.title = "下载原图 PNG " + mb(it.b);
    dl.setAttribute("aria-label", "下载 " + it.id + " 的原图");''',
    '''    dl.setAttribute("download", "face-" + it.id + ".webp");
    dl.title = "下载这张图（400×500 WebP）";
    dl.setAttribute("aria-label", "下载 " + it.id);''')
rep("</svg><span>PNG</span>'", "</svg><span>WebP</span>'")

# 4) 灯箱下载按钮
rep('''    dl.setAttribute("download", "face-" + it.id + ".png");
    dl.textContent = localFullOK ? "下载原图（PNG）" : "下载原图（原站）";''',
    '''    dl.setAttribute("download", "face-" + it.id + ".webp");
    dl.textContent = it.local ? "下载我的原图" : "下载图片（400×500）";''')

# 5) 灯箱里「原图 2.6 MB」在这版是误导（实际给的是 400×500 WebP）
rep('    $("#lb-bytes").textContent = mb(it.b);',
    '    $("#lb-bytes").textContent = it.local ? "原始上传文件" : "WebP 400×500";')

# 6) 「尺寸」也要说实际下载尺寸，不然写着 1122×1402 却给 400×500
rep('    $("#lb-size").textContent = it.w && it.h ? it.w + " × " + it.h : "—";',
    '    $("#lb-size").textContent = it.local && it.w && it.h ? it.w + " × " + it.h : "400 × 500";')

open(p, "w", encoding="utf-8").write(s)
print("app.js 已改")

# ---------- 改 index.html ----------
p = os.path.join(OUT, "index.html")
h = open(p, encoding="utf-8").read()

def hrep(old, new):
    global h
    assert old in h, "未找到：" + old[:50]
    h = h.replace(old, new)

hrep('''
      <p class="lead" style="margin-top:18px;font-size:.8rem">原站只有日文界面、图片走外链；这一版做了全站汉化、素材全本地、搜索 / 收藏 / 上传 / AI 提示词，双击 <code>index.html</code> 就能用。</p>''',
     '''
      <p class="lead" style="margin-top:18px;font-size:.8rem">解压后双击 <code>index.html</code> 就能用，不用装任何东西、断网也能翻。收藏和上传的图都存在你自己的浏览器里。</p>''')

hrep('''      <li><b>下载</b>：卡片右下角的「PNG」或详情里的「下载原图」，拿到的都是本地 1122×1402 / 1597×2000 左右的原尺寸 PNG，不是缩略图。</li>''',
     '''      <li><b>下载</b>：卡片右下角的「WebP」或详情里的「下载图片」，拿到的是 400×500 的预览图（极清原图不随这一版分发，需要的话去原站下载）。</li>''')

hrep('''      <li>共 1499 张，其中正面人脸 893 张、造型 606 张，全部为 AI 生成的虚构人物。</li>
      <li>所有图片（缩略图 WebP + 原图 PNG）都已随项目落地到 <code>assets/</code>，不依赖任何 CDN。</li>''',
     '''      <li>共 1499 张，其中正面人脸 893 张、造型 606 张，全部为 AI 生成的虚构人物。</li>
      <li>1499 张 400×500 WebP 全部随包附带，不依赖任何网站，断网可用。</li>''')

hrep('''      <dt>原图</dt><dd id="lb-bytes">—</dd>''',
     '''      <dt>格式</dt><dd id="lb-bytes">—</dd>''')

open(p, "w", encoding="utf-8").write(h)
print("index.html 已改")

# ---------- 打包 ----------
if os.path.exists(ZIP):
    os.remove(ZIP)
os.rename(OUT, os.path.join(os.path.dirname(OUT), NAME))
try:
    subprocess.run(["zip", "-r", "-q", ZIP, NAME], cwd=os.path.dirname(OUT), check=True)
finally:
    os.rename(os.path.join(os.path.dirname(OUT), NAME), OUT)

size = os.path.getsize(ZIP) / 1048576
print("打包完成：%s（%.1f MB）" % (ZIP, size))
