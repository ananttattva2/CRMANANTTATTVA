import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function ScrollToTop() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) return undefined;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    const resetScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;

      const scrollRoots = document.querySelectorAll([
        '#root',
        'main',
        'section',
        '[data-scroll-root]',
        '.calendar-page',
        '.notifications-page',
        '.annual-workspace',
        '.lead-directory-scroll',
        '.hidden-scrollbar'
      ].join(','));

      scrollRoots.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.scrollTop > 0) node.scrollTop = 0;
        if (node.scrollLeft > 0) node.scrollLeft = 0;
      });
    };

    resetScroll();
    const frameId = requestAnimationFrame(resetScroll);
    const timeoutId = window.setTimeout(resetScroll, 80);

    return () => {
      cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [pathname, search]);

  return null;
}
