import { gsap } from 'gsap';
import Lenis from 'lenis';

const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- nav pill: slides to the active / hovered link ---------- */
function activeHref(path: string) {
  if (path === '/') return '/';
  const seg = '/' + path.split('/').filter(Boolean)[0] + '/';
  return seg;
}
function movePill(target: HTMLElement | null, instant = false) {
  const pill = document.querySelector<HTMLElement>('.nav-pill');
  const nav = document.querySelector<HTMLElement>('.nav');
  if (!pill || !nav) return;
  if (!target) { pill.style.opacity = '0'; return; }
  const nr = nav.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  if (instant) pill.style.transition = 'none';
  pill.style.opacity = '1';
  pill.style.width = r.width + 'px';
  pill.style.transform = `translateX(${r.left - nr.left}px)`;
  if (instant) { pill.offsetWidth; pill.style.transition = ''; }
}
let navBound = false;
function setupNav(first: boolean) {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-nav]')];
  const href = activeHref(location.pathname);
  let current: HTMLElement | null = null;
  links.forEach((a) => {
    const on = a.dataset.nav === href;
    a.toggleAttribute('aria-current', on);
    if (on) { a.setAttribute('aria-current', 'page'); current = a; }
  });
  movePill(current, first);
  if (navBound) return;
  navBound = true;
  const nav = document.querySelector('.nav')!;
  links.forEach((a) => a.addEventListener('pointerenter', () => movePill(a)));
  nav.addEventListener('pointerleave', () =>
    movePill(document.querySelector<HTMLElement>('[data-nav][aria-current="page"]')));
  window.addEventListener('resize', () =>
    movePill(document.querySelector<HTMLElement>('[data-nav][aria-current="page"]'), true));
}

/* ---------- theme toggle with circular reveal ---------- */
let themeBound = false;
function setupTheme() {
  if (themeBound) return;
  themeBound = true;
  document.querySelector('[data-theme-toggle]')?.addEventListener('click', (e) => {
    const d = document.documentElement;
    const next = d.dataset.theme === 'dark' ? 'light' : 'dark';
    const apply = () => { d.dataset.theme = next; localStorage.setItem('ls-theme', next); };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition || reduce()) return apply();
    const { clientX: x, clientY: y } = e as MouseEvent;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    d.classList.add('theme-vt');
    const vt = doc.startViewTransition(apply) as { ready: Promise<void>; finished?: Promise<void> };
    vt.finished?.finally(() => d.classList.remove('theme-vt'));
    vt.ready.then(() => {
      d.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 550, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  });
}

/* ---------- header border on scroll + reading progress (rAF-throttled) ---------- */
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    document.querySelector('.site-header')?.classList.toggle('scrolled', scrollY > 8);
    const bar = document.getElementById('progress');
    const article = document.querySelector<HTMLElement>('[data-article]');
    if (bar) {
      if (!article) { bar.style.transform = 'scaleX(0)'; return; }
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    }
  });
}
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- card spotlight follows the pointer (one write per frame) ---------- */
function setupCards() {
  document.querySelectorAll<HTMLElement>('.card').forEach((c) => {
    let raf = 0, x = 0, y = 0, rect: DOMRect | null = null;
    c.addEventListener('pointerenter', () => { rect = c.getBoundingClientRect(); }, { passive: true });
    c.addEventListener('pointermove', (e) => {
      if (!rect) rect = c.getBoundingClientRect();
      x = e.clientX - rect.left; y = e.clientY - rect.top;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        c.style.setProperty('--mx', `${x}px`);
        c.style.setProperty('--my', `${y}px`);
      });
    }, { passive: true });
    c.addEventListener('pointerleave', () => { rect = null; }, { passive: true });
  });
}

/* ---------- smooth wheel scrolling (desktop mouse/trackpad only) ---------- */
let lenis: Lenis | null = null;
function setupLenis() {
  if (lenis || reduce() || matchMedia('(pointer: coarse)').matches) return;
  lenis = new Lenis({ lerp: 0.12, wheelMultiplier: 1, smoothWheel: true });
  lenis.on('scroll', onScroll);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}
document.addEventListener('astro:before-preparation', () => lenis?.stop());
document.addEventListener('astro:after-swap', () => {
  // the router has already set the scroll position; sync Lenis to it with no animation
  lenis?.scrollTo(scrollY, { immediate: true, force: true });
  lenis?.start();
});

/* ---------- entrance ----------
   first load: above-the-fold content staggers in.
   in-site navigation: it rises in at the same moment the page cross-fades (not after),
   so there is one motion instead of two in a row.
   everything below the fold reveals on scroll. */
let io: IntersectionObserver | null = null;
const shown = new WeakSet<Element>();
function aboveFold() {
  const fold = innerHeight * 0.95;
  return [...document.querySelectorAll<HTMLElement>('[data-reveal]')]
    .filter((el) => !shown.has(el) && el.getBoundingClientRect().top < fold);
}
function enter(els: HTMLElement[], fast: boolean) {
  if (!els.length) return;
  els.forEach((el) => shown.add(el));
  if (reduce()) { gsap.set(els, { opacity: 1 }); return; }
  gsap.fromTo(els,
    { opacity: 0, y: fast ? 14 : 22 },
    { opacity: 1, y: 0, duration: fast ? 0.5 : 0.8, ease: 'power3.out',
      stagger: fast ? 0.035 : 0.06, delay: fast ? 0 : 0.05, clearProps: 'transform', overwrite: true });
}
function observeRest() {
  io?.disconnect();
  const rest = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter((el) => !shown.has(el));
  if (reduce()) { gsap.set(rest, { opacity: 1 }); return; }
  io = new IntersectionObserver((entries) => {
    const batch = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
    if (!batch.length) return;
    batch.forEach((el) => { io!.unobserve(el); shown.add(el); });
    gsap.fromTo(batch,
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: 0.65, ease: 'power3.out', stagger: 0.05, clearProps: 'transform' });
  }, { rootMargin: '0px 0px -4% 0px' });
  rest.forEach((el) => io!.observe(el));
}

/* ---------- heavy embeds wait until the transition is over ---------- */
function loadDeferred() {
  const go = () => document.querySelectorAll<HTMLIFrameElement>('iframe[data-src]').forEach((f) => {
    f.src = f.dataset.src!; f.removeAttribute('data-src');
  });
  ('requestIdleCallback' in window) ? requestIdleCallback(go, { timeout: 800 }) : setTimeout(go, 300);
}

let first = true;
document.addEventListener('astro:after-swap', () => enter(aboveFold(), true));
document.addEventListener('astro:page-load', () => {
  setupLenis();
  setupNav(first);
  setupTheme();
  setupCards();
  if (first) enter(aboveFold(), false);
  observeRest();
  onScroll();
  loadDeferred();
  first = false;
});
