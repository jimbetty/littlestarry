import { gsap } from 'gsap';

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

/* ---------- card spotlight follows the pointer ---------- */
function setupCards() {
  document.querySelectorAll<HTMLElement>('.card').forEach((c) => {
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', `${e.clientX - r.left}px`);
      c.style.setProperty('--my', `${e.clientY - r.top}px`);
    }, { passive: true });
  });
}

/* ---------- entrance: above the fold staggers in, the rest reveals on scroll ---------- */
let io: IntersectionObserver | null = null;
function reveal() {
  const els = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
  if (reduce()) { gsap.set(els, { opacity: 1 }); return; }
  io?.disconnect();
  const fold = innerHeight * 0.92;
  const now = els.filter((el) => el.getBoundingClientRect().top < fold);
  const later = els.filter((el) => !now.includes(el));
  gsap.fromTo(now,
    { opacity: 0, y: 24 },
    { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.06, delay: 0.08, clearProps: 'transform' });
  io = new IntersectionObserver((entries) => {
    const batch = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
    if (!batch.length) return;
    batch.forEach((el) => io!.unobserve(el));
    gsap.fromTo(batch,
      { opacity: 0, y: 32 },
      { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, clearProps: 'transform' });
  }, { rootMargin: '0px 0px -8% 0px' });
  later.forEach((el) => io!.observe(el));
}

let first = true;
document.addEventListener('astro:page-load', () => {
  setupNav(first);
  setupTheme();
  setupCards();
  reveal();
  onScroll();
  first = false;
});
