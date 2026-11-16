#!/usr/bin/env python3
"""pokesurvivor.com -> this folder (branch main-web: the game as published, untouched).

The repo of the game is gone; the live site (GitHub Pages) is the only source. Same layout as the site: every
file at the same path as its URL. Stdlib only.

  python3 tools/mirror.py version   local build vs live (version.json "v")
  python3 tools/mirror.py update    refresh every file in place, add new ones, delete the ones the site dropped

Files: the ones already here (git) + what the HTML pages reference (src/href, ?v= dropped) + the pages in the
sitemap + new Pokémon sprite folders (assets/pokemon/<dex>/, probed: the bundle is obfuscated, no list to read).
Each GET sends If-None-Match with the ETag of the last run (tools/mirror-etags.json): unchanged files cost a 304.
"""
import concurrent.futures as cf
import http.client
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HOST = 'https://pokesurvivor.com'
ROOT = Path(__file__).resolve().parent.parent
ETAGS = ROOT / 'tools' / 'mirror-etags.json'
UA = {'User-Agent': 'Mozilla/5.0 (offline mirror)'}
MINE = ('tools/', '.github/', '.nojekyll')   # ours or not served: never fetched nor deleted
ANIMS = ('Attack', 'Charge', 'Faint', 'Hurt', 'Idle', 'Shoot', 'Walk')
TRIES = 8   # (IncompleteRead on big files is common: retry)
MAX_DEX = 1100   # ponytail: sprite folders probed up to here; raise when the game passes it
TYPES = ('normal fire water grass electric ice fighting poison ground flying psychic bug rock ghost dragon dark steel '
         'fairy').split()
# Profile photos (assets/tienda/fotos-perfil/<dex>/[s/]<expr>.png): the PMD portrait names (the bundle hides some).
EXPR = ('normal happy joyous inspired determined surprised stunned worried sigh sad teary-eyed crying angry shouting pain '
        'dizzy special0 special1 special2 special3').split()


def forms():
    """Form ids (sprite folders 300000-999999) from js/app.min.js: 'id':0x493e6 in its form tables."""
    js = (ROOT / 'js/app.min.js').read_text(encoding='utf-8', errors='replace')
    return {i for i in (int(x, 16) for x in re.findall(r"'id':(0x[0-9a-f]{5})\b", js)) if 300000 <= i < 1000000}


def lazy(dexes):
    """Files the game builds names for at runtime (no page references them): read the lists from js/app.min.js."""
    js = (ROOT / 'js/app.min.js').read_text(encoding='utf-8', errors='replace')
    out = {'assets/arenas/' + f for f in re.findall(r"'f':'([\w-]+\.(?:png|jpg))'", js)}
    for fid, anim in re.findall(r"\{'id':'([a-z0-9_]+)','name':[^{}]*?'cat':[^{}]*?('anim':)?[^{}]*?\}", js):
        out |= {f'assets/tienda/marcos/{fid}.png'} | ({f'assets/tienda/marcos/{fid}-anim.png'} if anim else set())
    out |= {f'assets/arenas/{t}.{x}' for t in TYPES for x in ('png', 'jpg')}   # (some names are hidden in the bundle)
    out |= {f'assets/tienda/marcos/maestria_{t}{a}.png' for t in TYPES for a in ('', '-anim')}
    for d in (d for d in dexes if d < 300000):   # (las formas no tienen huevo, grito ni foto: 404 en todas, 16-11-2026)
        out |= {f'assets/eggs/{d}.png', f'assets/eggs/s/{d}.png', f'assets/cries/{d}.mp3'}
        out |= {f'assets/tienda/fotos-perfil/{d}/{s}{e}.png' for e in EXPR for s in ('', 's/')}
    return out


def download(path, etag=None):
    """(status, bytes, etag). 304 -> no bytes. 3 tries on network errors; 404 is an answer, not an error."""
    req = urllib.request.Request(HOST + '/' + path.lstrip('/'), headers=dict(UA, **({'If-None-Match': etag} if etag else {})))
    for i in range(TRIES):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.read(), r.headers.get('ETag')
        except urllib.error.HTTPError as e:
            if e.code in (304, 404):
                return e.code, b'', etag
            if i == TRIES - 1:
                raise
            if e.code == 429 or e.code >= 500:   # (GitHub Pages limita: espera lo que diga, o 30 s, cada vez más)
                time.sleep(max(30, int(e.headers.get('Retry-After') or 0)) * (i + 1))
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, ConnectionError, OSError) as e:
            if i == TRIES - 1:
                raise RuntimeError(f'{path}: {e}')
    raise AssertionError


def local(path):
    """Path inside ROOT for a site path ('' or 'x/' -> index.html), or a ValueError."""
    p = path.split('?')[0].split('#')[0].lstrip('/')
    if p == '' or p.endswith('/'):
        p += 'index.html'
    f = (ROOT / p).resolve()
    if ROOT not in f.parents:
        raise ValueError(f'outside the mirror: {path}')
    return f


def save(f, data):
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f'{f.name}.{threading.get_ident()}.part')
    tmp.write_bytes(data)
    tmp.replace(f)


def build_id(text):
    return json.loads(text).get('v', '?')


def tracked():
    out = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return {p for p in out.splitlines() if not p.startswith(MINE)}


def refs(html, base):
    """Same-site files an HTML page points at (relative to the page's folder)."""
    out = set()
    b = re.search(r'<base href="([^"]+)"', html)   # (en/index.html: <base href="../">)
    if b:
        base = os.path.normpath(base + b.group(1)).replace('\\', '/').lstrip('.') + '/'
        base = '' if base in ('/', './') else base.lstrip('/')
        html = html.replace(b.group(0), '')
    for u in re.findall(r'(?:src|href)="([^"#]+)"', html):
        u = u.split('?')[0]
        if u.startswith(HOST):
            u = u[len(HOST):]
        elif re.match(r'^[a-z]+:|^//', u):
            continue
        p = os.path.normpath(u.lstrip('/') if u.startswith('/') else base + u).replace('\\', '/')
        if u.endswith('/') or u == '':
            p = 'index.html' if p == '.' else p + '/index.html'
        if not p.startswith('..') and p != '.':
            out.add(p)
    return out


def update():
    etags = json.loads(ETAGS.read_text()) if ETAGS.exists() else {}
    live = download('version.json')[1].decode()
    old = build_id((ROOT / 'version.json').read_text()) if (ROOT / 'version.json').exists() else '-'
    print(f'local {old} · live {build_id(live)}')

    files, done, lock = set(tracked()), {}, threading.Lock()
    miss_file = ROOT / 'tools' / f'.missing-{build_id(live)}.txt'
    missing_before = set(miss_file.read_text().split()) if miss_file.exists() else set()
    sitemap = download('sitemap.xml')[1].decode()
    files |= {re.sub(r'^/', '', u[len(HOST):]) + ('index.html' if u.endswith('/') else '')
              for u in re.findall(r'<loc>([^<]+)</loc>', sitemap) if u.startswith(HOST)}

    def get(p):
        st, data, et = download(p, etags.get(p))
        if st == 200:
            save(local(p), data)
        with lock:
            done[p] = st
            if et and st != 404:
                etags[p] = et
        return p, st, data

    try:
        with cf.ThreadPoolExecutor(12) as ex:
            # 1. pages (and what they reference, until nothing new appears)
            todo = {p for p in files if p.endswith('.html')}
            seen = set()
            while todo:
                seen |= todo
                new = set()
                for p, st, data in ex.map(get, sorted(todo)):
                    f = local(p)
                    if st in (200, 304) and f.exists():
                        new |= refs(f.read_text(errors='replace'), p.rsplit('/', 1)[0] + '/' if '/' in p else '')
                files |= new
                todo = {p for p in new if p.endswith('.html')} - seen
            # 2. new sprite folders: Idle.png of every dex not here yet
            have = {int(m.group(1)) for p in files if (m := re.match(r'assets/pokemon/(\d+)/', p))}
            probe = [f'assets/pokemon/{d}/Idle.png' for d in range(1, MAX_DEX + 1) if d not in have]
            have |= {int(p.split('/')[2]) for p, st, _ in ex.map(get, probe) if st == 200}
            have |= forms()   # (Mega, Gigamax, Ash-Greninja, regionales…: 300000-999999, del bundle)
            # every folder with all its sheets (the pages only reference Idle.png; a 404 = that form has no such sheet)
            files |= {f'assets/pokemon/{d}/{s}{a}.png' for d in have for a in ANIMS for s in ('', 's/')}
            # 3. what the game names at runtime (most of it 404s: remembered per build, never asked again until it changes)
            files |= {p for p in lazy(have) if p not in missing_before}
            # 4. everything else
            rest = sorted(p for p in files if p not in done)
            for i, (p, st, _) in enumerate(ex.map(get, rest), 1):
                if i % 2000 == 0:
                    print(f'  {i}/{len(rest)}')
    finally:   # (también si se corta: lo bajado ya cuenta la próxima vez)
        ETAGS.write_text(json.dumps(dict(sorted(etags.items())), indent=0) + '\n')
        miss_file.write_text('\n'.join(sorted(missing_before | {p for p, st in done.items() if st == 404})) + '\n')
    gone = sorted(p for p, st in done.items() if st == 404 and p in tracked())
    for p in gone:   # dropped by the site (the old copy stays in git history)
        local(p).unlink(missing_ok=True)
    missing = sorted(p for p, st in done.items() if st == 404 and p not in gone and not p.startswith(('assets/pokemon/', 'assets/eggs/',
                     'assets/cries/', 'assets/tienda/')))
    print(f'{sum(st == 200 for st in done.values())} downloaded · {sum(st == 304 for st in done.values())} unchanged · '
          f'{len(gone)} removed by the site · build {build_id((ROOT / "version.json").read_text())}')
    for p in gone:
        print('  removed', p)
    for p in missing:
        print('  404 (referenced, not on the site)', p)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'version':
        print('local ', build_id((ROOT / 'version.json').read_text()))
        print('online', build_id(download('version.json')[1].decode()))
    elif cmd == 'update':
        update()
    else:
        sys.exit(__doc__)
