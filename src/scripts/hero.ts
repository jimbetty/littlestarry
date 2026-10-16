import { gsap } from 'gsap';

type Item = { title: string; text: string; url: string; kind: string };
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let cleanup: (() => void) | null = null;
export function teardownHero() { cleanup?.(); cleanup = null; }

export function setupHero(firstLoad: boolean) {
  teardownHero();
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (!hero) return;
  const offs: (() => void)[] = [];
  const on = (t: EventTarget, ev: string, fn: any, opt?: any) => { t.addEventListener(ev, fn, opt); offs.push(() => t.removeEventListener(ev, fn, opt)); };
  const rm = reduce();

  /* ---- entrance: tiles bloom out from the centre, headline + search rise ---- */
  const tiles = [...hero.querySelectorAll<HTMLElement>('.tile')];
  const inner = hero.querySelectorAll<HTMLElement>('.hero-title, .hero-search, .hero-cta, .hero-next');
  if (rm) { gsap.set(tiles, { opacity: (_i: number, el: HTMLElement) => +el.style.getPropertyValue('--o') }); gsap.set(inner, { opacity: 1 }); }
  else {
    tiles.sort((a, b) => parseFloat(a.style.getPropertyValue('--d')) - parseFloat(b.style.getPropertyValue('--d')));
    gsap.fromTo(tiles,
      { opacity: 0, scale: 0.6 },
      { opacity: (_i: number, el: HTMLElement) => +el.style.getPropertyValue('--o'), scale: 1,
        duration: firstLoad ? 1.1 : 0.7, ease: 'expo.out', stagger: firstLoad ? 0.025 : 0.01, delay: firstLoad ? 0.1 : 0, clearProps: 'scale' });
    gsap.fromTo(inner,
      { opacity: 0, y: firstLoad ? 26 : 12, scale: firstLoad ? 0.97 : 1 },
      { opacity: 1, y: 0, scale: 1, duration: firstLoad ? 0.9 : 0.5, ease: 'power3.out', stagger: 0.06, clearProps: 'transform' });
  }

  /* ---- background tilts with the pointer (whole layer, transform only, eased in rAF) ---- */
  const field = hero.querySelector<HTMLElement>('.hero-field')!;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, visible = true;
  const tick = () => {
    cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
    field.style.transform = `rotateX(${cx.toFixed(3)}deg) rotateY(${cy.toFixed(3)}deg)`;
    raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.01 ? requestAnimationFrame(tick) : 0;
  };
  const kick = () => { if (!raf && visible) raf = requestAnimationFrame(tick); };
  if (!rm && matchMedia('(pointer: fine)').matches) {
    on(window, 'pointermove', (e: PointerEvent) => {
      if (!visible) return;
      ty = (e.clientX / innerWidth - 0.5) * 10;
      tx = -(e.clientY / innerHeight - 0.5) * 8;
      kick();
    }, { passive: true });
    on(document.documentElement, 'pointerleave', () => { tx = ty = 0; kick(); });
  }
  const vis = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    hero.classList.toggle('offscreen', !visible); // pauses tile float while scrolled away
  });
  vis.observe(hero);
  offs.push(() => { vis.disconnect(); cancelAnimationFrame(raf); });

  /* ---- rotating phrase: vertical 3D roll, thumbnails ride along ---- */
  const phrases = [...hero.querySelectorAll<HTMLAnchorElement>('[data-rotator] .phrase')];
  let idx = 0;
  const setActive = (i: number) => phrases.forEach((p, j) => {
    const a = i === j;
    p.toggleAttribute('aria-hidden', !a); p.tabIndex = a ? 0 : -1; p.style.pointerEvents = a ? 'auto' : 'none';
  });
  gsap.set(phrases, { opacity: (i: number) => (i ? 0 : 1) });
  const next = () => {
    if (document.hidden || !visible) return;
    const cur = phrases[idx]; idx = (idx + 1) % phrases.length; const nxt = phrases[idx];
    setActive(idx);
    if (rm) { gsap.set(cur, { opacity: 0 }); gsap.set(nxt, { opacity: 1 }); }
    else {
      gsap.to(cur, { rotateX: 90, yPercent: -35, opacity: 0, duration: 0.5, ease: 'power3.in', overwrite: true });
      gsap.fromTo(nxt, { rotateX: -90, yPercent: 35, opacity: 0 },
        { rotateX: 0, yPercent: 0, opacity: 1, duration: 0.7, ease: 'power3.out', delay: 0.22, overwrite: true });
    }
    type(nxt.dataset.q || '');
  };
  const timer = setInterval(next, 3600);
  offs.push(() => clearInterval(timer));

  /* ---- search: typewriter placeholder follows the phrase; live results ---- */
  const field2 = hero.querySelector<HTMLElement>('.search-field')!;
  const input = hero.querySelector<HTMLInputElement>('[data-search-input]')!;
  const typed = hero.querySelector<HTMLElement>('[data-ph-typed]')!;
  const list = hero.querySelector<HTMLUListElement>('[data-search-results]')!;
  const go = hero.querySelector<HTMLAnchorElement>('[data-search-go]')!;
  const index: Item[] = JSON.parse(hero.querySelector('[data-search-index]')?.textContent || '[]');
  let typeTimer = 0;
  function type(word: string) {
    clearInterval(typeTimer);
    if (rm) { typed.textContent = word; return; }
    let n = 0; typed.textContent = '';
    typeTimer = window.setInterval(() => {
      typed.textContent = word.slice(0, ++n);
      if (n >= word.length) clearInterval(typeTimer);
    }, 90);
  }
  offs.push(() => clearInterval(typeTimer));
  type(phrases[0]?.dataset.q || '');

  let results: Item[] = []; let active = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    field2.classList.toggle('has-value', !!input.value);
    if (!q) { list.classList.remove('open'); go.href = phrases[idx].href; return; }
    results = index.filter((it) => (it.title + ' ' + it.text).toLowerCase().includes(q)).slice(0, 6);
    active = 0;
    list.innerHTML = results.length
      ? results.map((r, i) => `<li><a href="${r.url}" class="${i ? '' : 'active'}"><span>${r.title.replace(/</g, '&lt;')}</span><small>${r.kind}</small></a></li>`).join('')
      : '<li class="empty">没有找到相关内容</li>';
    go.href = results[0]?.url || '/works/';
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
      e.preventDefault(); (links[active] || go).click();
    } else if (e.key === 'Escape') { input.blur(); list.classList.remove('open'); }
  });
  on(document, 'pointerdown', (e: Event) => { if (!hero.querySelector('[data-search]')!.contains(e.target as Node)) list.classList.remove('open'); });
  on(go, 'click', (e: Event) => { if (!input.value.trim()) { (go as HTMLAnchorElement).href = phrases[idx].href; } void e; });

  /* ---- scroll cue ---- */
  on(hero.querySelector('[data-hero-next]')!, 'click', (e: Event) => {
    e.preventDefault();
    const t = document.getElementById('next'); if (!t) return;
    const lenis = (window as any).__lenis;
    if (lenis) lenis.scrollTo(t, { offset: -96, duration: 1.1 });
    else t.scrollIntoView({ behavior: rm ? 'auto' : 'smooth' });
  });

  cleanup = () => offs.forEach((f) => f());
}
