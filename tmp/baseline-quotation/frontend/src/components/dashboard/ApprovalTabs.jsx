import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ApprovalTabs({ tabs = [], activeTab, onTabChange }) {
  const tablistRef = useRef(null);
  const tabRefs = useRef({});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollIndicators = useCallback(() => {
    const el = tablistRef.current;
    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  useLayoutEffect(() => {
    updateScrollIndicators();
  }, [tabs, updateScrollIndicators]);

  useEffect(() => {
    const el = tablistRef.current;
    if (!el) return undefined;
    const handler = () => updateScrollIndicators();
    el.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(handler);
      ro.observe(el);
      tabs.forEach((tab) => {
        const node = tabRefs.current?.[tab?.id];
        if (node) ro.observe(node);
      });
      return () => {
        el.removeEventListener('scroll', handler);
        window.removeEventListener('resize', handler);
        ro.disconnect();
      };
    }
    handler();
    return () => {
      el.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    };
  }, [tabs, updateScrollIndicators]);

  useEffect(() => {
    const activeEl = tabRefs.current?.[activeTab];
    const container = tablistRef.current;
    if (!activeEl || !container) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const overflowsLeft = activeRect.left < containerRect.left + 4;
    const overflowsRight = activeRect.right > containerRect.right - 4;
    if (overflowsLeft || overflowsRight) {
      if (overflowsLeft) {
        container.scrollBy({ left: activeRect.left - containerRect.left - 16, behavior: 'smooth' });
      } else {
        container.scrollBy({ left: activeRect.right - containerRect.right + 16, behavior: 'smooth' });
      }
    }
  }, [activeTab]);

  function scrollByDistance(distance) {
    tablistRef.current?.scrollBy({ left: distance, behavior: 'smooth' });
  }

  function handleKeyDown(event) {
    const focusedId = document.activeElement?.getAttribute?.('data-tab-id');
    const visibleIds = tabs.map((t) => t.id);
    const currentIdx = focusedId ? visibleIds.indexOf(focusedId) : visibleIds.indexOf(activeTab);
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = visibleIds[(currentIdx + 1 + visibleIds.length) % visibleIds.length];
      tabRefs.current[next]?.focus();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prev = visibleIds[(currentIdx - 1 + visibleIds.length) % visibleIds.length];
      tabRefs.current[prev]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      tabRefs.current[visibleIds[0]]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      tabRefs.current[visibleIds[visibleIds.length - 1]]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (focusedId) {
        event.preventDefault();
        onTabChange(focusedId);
      }
    }
  }

  const hasScrollableOverflow = canScrollLeft || canScrollRight;

  return (
    <div className={`approval-tabs-outer ${hasScrollableOverflow ? 'is-scrollable' : ''}`}>
      {canScrollLeft && (
        <button
          type="button"
          className="approval-tabs-nav approval-tabs-nav-left"
          onClick={() => scrollByDistance(-280)}
          aria-label="Scroll tabs left"
          tabIndex={-1}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Approval category tabs"
        className="approval-tabs-scroll"
        onKeyDown={handleKeyDown}
      >
        <div className="approval-tabs-inner" role="presentation">
          {tabs.map((tab) => {
            if (!tab) return null;
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            const count = Number(tab.count ?? 0);
            const hasCount = count > 0;
            return (
              <button
                key={tab.id}
                ref={(node) => {
                  tabRefs.current[tab.id] = node;
                }}
                role="tab"
                data-tab-id={tab.id}
                id={`approval-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`approval-tabpanel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                className={`approval-tab ${isActive ? 'is-active' : ''} ${hasCount ? 'has-count' : 'is-zero'}`}
                onClick={() => onTabChange(tab.id)}
              >
                <span className="approval-tab-inner">
                  {Icon ? (
                    <span className={`approval-tab-icon ${isActive ? 'is-active' : ''}`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                  ) : null}
                  <span className="approval-tab-label">{tab.label}</span>
                  <span
                    className={`approval-tab-badge ${isActive ? 'is-active' : ''} ${
                      hasCount ? 'has-count' : 'is-zero'
                    }`}
                    aria-hidden={false}
                  >
                    {count}
                  </span>
                </span>
                <span className="approval-tab-indicator" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      {canScrollRight && (
        <button
          type="button"
          className="approval-tabs-nav approval-tabs-nav-right"
          onClick={() => scrollByDistance(280)}
          aria-label="Scroll tabs right"
          tabIndex={-1}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
