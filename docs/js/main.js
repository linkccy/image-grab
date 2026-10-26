/**
 * 图提取 · 官网交互
 *
 * 三件事：
 *   1. 滚动时给导航加毛玻璃背景
 *   2. 移动端汉堡菜单
 *   3. 区块进入视口时淡入，并高亮当前对应的导航项
 *
 * 没有引入任何第三方库，IntersectionObserver 不支持的浏览器会直接
 * 把所有 .reveal 元素显示出来，保证内容不会因为动画失效而看不见。
 */

(() => {
  const nav = document.getElementById('nav');
  const navLinks = document.querySelectorAll('.nav-link[href^="#"]');
  const toggle = document.getElementById('navToggle');

  /* ---------- 导航背景 ---------- */
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 12);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- 移动端菜单 ---------- */
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- 入场动画 + 滚动高亮 ---------- */
  const revealItems = document.querySelectorAll('.reveal');
  const sections = [...document.querySelectorAll('section[id]')];

  // 导航高亮：找「已经滚过去」的最后一个区块，比 IntersectionObserver 更好预测
  const syncActiveLink = () => {
    const line = window.scrollY + window.innerHeight * 0.35;
    let current = '';
    sections.forEach((s) => {
      if (s.offsetTop <= line) current = s.id;
    });
    navLinks.forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
    });
  };
  syncActiveLink();
  window.addEventListener('scroll', syncActiveLink, { passive: true });
  window.addEventListener('resize', syncActiveLink);

  if (!('IntersectionObserver' in window)) {
    revealItems.forEach((el) => el.classList.add('in'));
    return;
  }

  // 逐个出现，同一批里稍微错开一点，看起来更自然
  const appearObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        setTimeout(() => el.classList.add('in'), i * 70);
        appearObserver.unobserve(el);
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );
  revealItems.forEach((el) => appearObserver.observe(el));
})();
