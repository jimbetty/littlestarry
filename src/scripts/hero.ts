import { gsap } from 'gsap';
import { navigate } from 'astro:transitions/client';

type Item = { title: string; text: string; url: string; kind: string };
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let cleanup: (() => void) | null = null;
export function teardownHero() { cleanup?.(); cleanup = null; }

const easeOut = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

export function setupHero(firstLoad: boolean) {
  teardownHero();
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero) return;
  const offs: (() => void)[] = [];
  const on = (t: EventTarget, ev: string, fn: any, opt?: any) => { t.addEventListener(ev, fn, opt); offs.push(() => t.removeEventListener(ev, fn, opt)); };
  const rm = reduce();

  /* ================= tile tunnel =================
     A long tube seen from inside. Cards ride its wall toward the camera, the
     tube turns slowly, and anything that would cover the text fades away. */
  const P = 1000;                        // must match .hero-stage perspective
  const SC_FAR = 0.2, SC_NEAR = 1.12;     // perspective scale band a card travels through (even spread on screen)
  const field = hero.querySelector<HTMLElement>('[data-field]')!;
  const inner = hero.querySelector<HTMLElement>('.hero-inner')!;
  const tiles = [...hero.querySelectorAll<HTMLElement>('.tile')].map((el) => ({
    el, th: +el.dataset.th!, d: +el.dataset.d!, rz: +el.dataset.rz!, m: el.dataset.m === '1',
    hw: el.offsetWidth / 2, hh: el.offsetHeight / 2, delay: 0, op: -1,
  }));
  let W = 0, H = 0, vy = 0, rx = 0, ry = 0, small = false;
  let clear = { l: 0, r: 0, t: 0, b: 0 }, cue = { l: 0, r: 0, t: 0, b: 0 }, sz = 1;
  const layout = () => {
    const r = hero.getBoundingClientRect();
    W = r.width; H = r.height; small = W < 760; vy = H * 0.42;
    rx = small ? W * 0.6 : W * 0.48;     // tube radius (world px at z = 0)
    ry = small ? H * 0.46 : H * 0.6;
    const ir = inner.getBoundingClientRect();
    const px = small ? 8 : 36, py = small ? 10 : 22;
    clear = { l: ir.left - r.left - px, r: ir.right - r.left + px, t: ir.top - r.top - py, b: ir.bottom - r.top + py };
    const nr = hero.querySelector<HTMLElement>('.hero-next')!.getBoundingClientRect();
    cue = { l: nr.left - r.left - 20, r: nr.right - r.left + 20, t: nr.top - r.top - 20, b: nr.bottom - r.top + 20 };
    sz = small ? 0.72 : 1;
    tiles.forEach((t) => (t.el.hidden = small && !t.m));
  };
  layout();
  const overlap = (b: typeof clear, sx: number, sy: number, hw: number, hh: number) =>
    (Math.max(0, Math.min(sx + hw, b.r) - Math.max(sx - hw, b.l)) * Math.max(0, Math.min(sy + hh, b.b) - Math.max(sy - hh, b.t))) / (4 * hw * hh);
  const start = performance.now() + (firstLoad ? 120 : 0);
  tiles.forEach((t) => (t.delay = (1 - t.d) * (firstLoad ? 600 : 300) + Math.random() * 120));
  const introDur = firstLoad ? 1600 : 900;

  const omega = rm ? 0 : 0.01;           // tube spin, rad/s
  const speed = rm ? 0 : 0.006;          // depth phase per second: a card drifts from the far end to the lens in ~3 min
  let tiltX = 0, tiltY = 0, tx = 0, ty = 0;
  let raf = 0, visible = true, last = performance.now(), angle = 0, travel = 0;
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  const frame = (now: number) => {
    const dt = Math.min(64, now - last); last = now;
    angle += omega * dt / 1000; travel += speed * dt / 1000;
    tiltX += (tx - tiltX) * 0.06; tiltY += (ty - tiltY) * 0.06;
    field.style.transform = `rotateX(${tiltX.toFixed(3)}deg) rotateY(${tiltY.toFixed(3)}deg)`;
    let introDone = true;
    for (const t of tiles) {
      if (t.el.hidden) continue;
      const ph = (t.d + travel) % 1;
      const k = rm ? 1 : easeOut(Math.max(0, (now - start - t.delay) / introDur));
      if (k < 1) introDone = false;
      const th = t.th + angle, c = Math.cos(th), s = Math.sin(th);
      const scT = (SC_FAR + (SC_NEAR - SC_FAR) * ph) * (0.12 + 0.88 * k);
      const z = P - P / scT;
      const x = c * rx, y = s * ry;
      const sc = scT;
      // where it lands on screen, to keep the headline, search and CTA clear
      const sx = W / 2 + x * sc, sy = vy + y * sc, hw = t.hw * sc * sz, hh = t.hh * sc * sz;
      const cover = Math.max(overlap(clear, sx, sy, hw, hh), overlap(cue, sx, sy, hw, hh));
      const head = smooth(54, 96, sy);                      // stay out of the header band
      const depth = smooth(0, 0.18, ph) * (1 - smooth(0.88, 1, ph)); // fade in from the far end, out at the lens
      const op = Math.round(k * depth * head * (1 - smooth(0, 0.35, cover)) * (0.3 + 0.7 * smooth(0.05, 0.6, ph)) * 100) / 100;
      // cards lie along the wall: turned to the tangent, leaning in toward the vanishing point
      t.el.style.transform =
        `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,${z.toFixed(1)}px) ` +
        `rotateZ(${(th * 57.2958 + 90 + t.rz).toFixed(2)}deg) rotateX(-28deg) scale(${sz})`;
      if (op !== t.op) { t.op = op; t.el.style.opacity = String(op); t.el.style.visibility = op ? '' : 'hidden'; }
    }
    const moving = omega > 0 || !introDone || Math.abs(tx - tiltX) + Math.abs(ty - tiltY) > 0.01;
    raf = visible && !document.hidden && moving ? requestAnimationFrame(frame) : 0;
  };
  const kick = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  kick();

  if (!rm && matchMedia('(pointer: fine)').matches) {
    on(window, 'pointermove', (e: PointerEvent) => {
      ty = (e.clientX / innerWidth - 0.5) * 9;
      tx = -(e.clientY / innerHeight - 0.5) * 7;
      kick();
    }, { passive: true });
    on(document.documentElement, 'pointerleave', () => { tx = ty = 0; kick(); });
  }
  let rzT = 0;
  on(window, 'resize', () => { clearTimeout(rzT); rzT = window.setTimeout(() => { layout(); kick(); }, 120); });
  on(document, 'visibilitychange', kick);
  const vis = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); });
  vis.observe(hero);
  offs.push(() => { vis.disconnect(); cancelAnimationFrame(raf); clearTimeout(rzT); });

  /* ================= headline / search entrance ================= */
  const parts = hero.querySelectorAll<HTMLElement>('.hero-title, .hero-search, .hero-cta, .hero-next');
  if (rm) gsap.set(parts, { opacity: 1 });
  else gsap.fromTo(parts,
    { opacity: 0, y: firstLoad ? 22 : 10 },
    { opacity: 1, y: 0, duration: firstLoad ? 1 : 0.5, ease: 'power3.out', stagger: 0.07, delay: firstLoad ? 0.35 : 0, clearProps: 'transform' });

  /* ================= rotating phrase ================= */
  const phrases = [...hero.querySelectorAll<HTMLAnchorElement>('[data-rotator] .phrase')];
  let idx = 0;
  const setActive = (i: number) => phrases.forEach((p, j) => {
    const a = i === j;
    p.toggleAttribute('aria-hidden', !a); p.tabIndex = a ? 0 : -1; p.style.pointerEvents = a ? 'auto' : 'none';
  });
  gsap.set(phrases, { opacity: (i: number) => (i ? 0 : 1) });
  const next = () => {
    if (document.hidden || !visible || hero.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return;
    const cur = phrases[idx]; idx = (idx + 1) % phrases.length; const nxt = phrases[idx];
    setActive(idx);
    wave(nxt.dataset.q || '');
    if (rm) { gsap.set(cur, { opacity: 0 }); gsap.set(nxt, { opacity: 1 }); return; }
    gsap.to(cur, { rotateX: 80, yPercent: -40, opacity: 0, duration: 0.45, ease: 'power2.in', overwrite: true });
    gsap.fromTo(nxt, { rotateX: -80, yPercent: 40, opacity: 0 },
      { rotateX: 0, yPercent: 0, opacity: 1, duration: 0.75, ease: 'power3.out', delay: 0.18, overwrite: true });
    gsap.fromTo(nxt.querySelectorAll('.thumb'), { scale: 0.5, y: 10 },
      { scale: 1, y: 0, duration: 0.7, ease: 'back.out(1.8)', stagger: 0.07, delay: 0.3, clearProps: 'transform' });
  };
  const timer = setInterval(next, 3800);
  offs.push(() => clearInterval(timer));

  /* ================= search ================= */
  const fieldBox = hero.querySelector<HTMLElement>('.search-field')!;
  const input = hero.querySelector<HTMLInputElement>('[data-search-input]')!;
  const ph = hero.querySelector<HTMLElement>('[data-ph]')!;
  const list = hero.querySelector<HTMLUListElement>('[data-search-results]')!;
  const dice = hero.querySelector<HTMLButtonElement>('[data-search-random]')!;
  const index: Item[] = JSON.parse(hero.querySelector('[data-search-index]')?.textContent || '[]');

  // placeholder: characters arrive dark, left to right, then settle grey
  function wave(word: string) {
    const text = `搜索${word}`;
    ph.classList.remove('wave');
    ph.innerHTML = [...text].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('');
    if (!rm) { void ph.offsetWidth; ph.classList.add('wave'); }
  }
  wave(phrases[0]?.dataset.q || '');

  let results: Item[] = []; let active = 0;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const render = () => {
    const q = input.value.trim().toLowerCase();
    fieldBox.classList.toggle('has-value', !!input.value);
    if (!q) { list.classList.remove('open'); results = []; return; }
    results = index.filter((it) => (it.title + ' ' + it.text).toLowerCase().includes(q)).slice(0, 6);
    active = 0;
    list.innerHTML = results.length
      ? results.map((r, i) => `<li><a href="${r.url}" class="${i ? '' : 'active'}"><span>${esc(r.title)}</span><small>${r.kind}</small></a></li>`).join('')
      : '<li class="empty">没有找到相关内容</li>';
    list.classList.add('open');
  };
  on(input, 'input', render);
  on(input, 'focus', render);
  on(input, 'keydown', (e: KeyboardEvent) => {
    const links = [...list.querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!links.length) return; e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach((a, i) => a.classList.toggle('active', i === active));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[active]?.url || (!input.value.trim() ? phrases[idx].href : '');
      if (target) navigate(target);
    } else if (e.key === 'Escape') { input.blur(); list.classList.remove('open'); }
  });
  on(document, 'pointerdown', (e: Event) => { if (!hero.querySelector('[data-search]')!.contains(e.target as Node)) list.classList.remove('open'); });
  // "/" focuses the search, like most search-first sites
  on(document, 'keydown', (e: KeyboardEvent) => {
    if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) { e.preventDefault(); input.focus(); }
  });
  on(dice, 'click', () => {
    if (!index.length) return;
    dice.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(240deg)' }], { duration: 500, easing: 'cubic-bezier(.22,1,.36,1)' });
    const pick = index[Math.floor(Math.random() * index.length)];
    setTimeout(() => navigate(pick.url), 220);
  });

  /* ================= scroll cue ================= */
  on(hero.querySelector('[data-hero-next]')!, 'click', (e: Event) => {
    e.preventDefault();
    const t = document.getElementById('next'); if (!t) return;
    const lenis = (window as any).__lenis;
    if (lenis) lenis.scrollTo(t, { offset: -96, duration: 1.1 });
    else t.scrollIntoView({ behavior: rm ? 'auto' : 'smooth' });
  });

  cleanup = () => offs.forEach((f) => f());
}
