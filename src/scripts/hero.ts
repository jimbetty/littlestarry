import { gsap } from 'gsap';
import { navigate } from 'astro:transitions/client';

type Item = { title: string; text: string; url: string; kind: string };
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let cleanup: (() => void) | null = null;
export function teardownHero() { cleanup?.(); cleanup = null; }

/* superellipse radius: a soft rounded-rectangle around the centre */
const sr = (c: number, s: number, a: number, b: number, n = 3.2) =>
  Math.pow(Math.pow(Math.abs(c) / a, n) + Math.pow(Math.abs(s) / b, n), -1 / n);
const easeOut = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));

export function setupHero(firstLoad: boolean) {
  teardownHero();
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero) return;
  const offs: (() => void)[] = [];
  const on = (t: EventTarget, ev: string, fn: any, opt?: any) => { t.addEventListener(ev, fn, opt); offs.push(() => t.removeEventListener(ev, fn, opt)); };
  const rm = reduce();

  /* ================= tile tunnel ================= */
  const P = 1000;                       // must match .hero-stage perspective
  const field = hero.querySelector<HTMLElement>('[data-field]')!;
  const inner = hero.querySelector<HTMLElement>('.hero-inner')!;
  const tiles = [...hero.querySelectorAll<HTMLElement>('.tile')].map((el, i) => ({
    el, th: +el.dataset.th!, e: +el.dataset.e!, rz: +el.dataset.rz!, m: el.dataset.m === '1',
    delay: 0, op: -1, i,
  }));
  let W = 0, H = 0, cx0 = 0, cy0 = 0, small = false;
  const layout = () => {
    const r = hero.getBoundingClientRect();
    W = r.width; H = r.height; small = W < 760;
    const ir = inner.getBoundingClientRect();
    cx0 = small ? W / 2 + 12 : Math.max(ir.width / 2 + 40, W * 0.2); // clear zone half-width (phones: tiles live above/below)
    cy0 = ir.height / 2 + (small ? 18 : 40);                    // clear zone half-height
    tiles.forEach((t) => (t.el.hidden = small && !t.m));
  };
  layout();
  // nearest ring flies in first, then outward
  const start = performance.now() + (firstLoad ? 120 : 0);
  tiles.forEach((t) => (t.delay = (1 - t.e) * (firstLoad ? 520 : 260) + Math.random() * 120));
  const introDur = firstLoad ? 1500 : 900;

  const omega = rm ? 0 : 0.012;         // rad per second: one lap ≈ 9 min, calm orbit
  let tiltX = 0, tiltY = 0, tx = 0, ty = 0;
  let raf = 0, visible = true, last = performance.now(), angle = 0;

  const frame = (now: number) => {
    const dt = Math.min(64, now - last); last = now;
    angle += omega * dt / 1000;
    tiltX += (tx - tiltX) * 0.06; tiltY += (ty - tiltY) * 0.06;
    field.style.transform = `rotateX(${tiltX.toFixed(3)}deg) rotateY(${tiltY.toFixed(3)}deg)`;
    const ex = W / 2, ey = H / 2;
    let introDone = true;
    for (const t of tiles) {
      if (t.el.hidden) continue;
      const th = t.th + angle, c = Math.cos(th), s = Math.sin(th);
      const rIn = sr(c, s, cx0, cy0);                        // edge of the clear zone at this angle
      const rOut = sr(c, s, ex, ey, 6) * 1.12;               // just past the screen edge
      const rho = rIn + Math.max(0, rOut - rIn) * t.e;       // projected distance from centre
      const k = rm ? 1 : easeOut(Math.max(0, (now - start - t.delay) / introDur));
      if (k < 1) introDone = false;
      const sc = 0.42 + 0.58 * t.e;                          // perspective scale: far = small
      const z = P - P / sc - (1 - k) * 2600;                 // intro: fly out of the vanishing point
      const R = rho / sc;                                     // world radius that projects to rho
      const tilt = 34 - t.e * 18;                             // far cards lean more toward the centre
      t.el.style.transform =
        `translate3d(${(c * R).toFixed(1)}px,${(s * R).toFixed(1)}px,${z.toFixed(1)}px) ` +
        `rotateY(${(-c * tilt).toFixed(2)}deg) rotateX(${(s * tilt).toFixed(2)}deg) rotateZ(${t.rz}deg)`;
      // phones: cards only live above and below the text; they fade out as the orbit carries them to the sides
      const side = small ? Math.min(1, Math.max(0, (Math.abs(s) - 0.45) / 0.25)) : 1;
      const op = Math.round(k * side * (0.28 + 0.72 * Math.pow(t.e, 0.8)) * 100) / 100;
      if (op !== t.op) { t.op = op; t.el.style.opacity = String(op); }
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
