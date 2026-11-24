import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function DashboardShell({ currentUser, onOpenProfile, onLogout, children, hideSidebar = false }) {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  function handleLogout() {
    try {
      sessionStorage.removeItem('crm.brandLoader.fullShown');
    } catch {
      // session cleanup only
    }
    if (onLogout) {
      onLogout();
      return;
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('login_email');
    localStorage.removeItem('dev_otp');
    navigate('/', { replace: true });
  }

  return (
    <main className="min-h-screen bg-[#eef7f5] pt-16 text-slate-900">
      <Topbar
        currentUser={currentUser}
        onOpenProfile={onOpenProfile}
        onOpenSidebar={() => {
          if (hideSidebar) return;
          setSidebarCollapsed(false);
          setSidebarOpen(true);
        }}
        onLogout={handleLogout}
      />
      <div className="flex min-h-[calc(100vh-5rem)]">
        {!hideSidebar && <aside
          className={`fixed bottom-0 left-0 top-16 z-40 w-[min(88vw,320px)] overflow-hidden rounded-tr-3xl border-r border-emerald-100 bg-white shadow-2xl shadow-slate-950/25 transition-all duration-300 ease-out lg:w-[296px] lg:translate-x-0 lg:overflow-visible lg:rounded-none lg:shadow-xl ${
            sidebarCollapsed ? 'lg:w-[84px]' : 'lg:w-[296px]'
          } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <Sidebar
            currentUser={currentUser}
            collapsed={sidebarCollapsed && !sidebarOpen}
            onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
            onClose={() => setSidebarOpen(false)}
            onLogout={handleLogout}
          />
        </aside>}

        {sidebarOpen && (
          <button
            type="button"
            className="fixed bottom-0 left-0 right-0 top-16 z-30 bg-slate-950/30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          />
        )}

        <section className={`min-w-0 flex-1 transition-all duration-300 ease-out ${hideSidebar ? '' : sidebarCollapsed ? 'lg:ml-[84px]' : 'lg:ml-[296px]'}`}>
          {children}
        </section>
      </div>
    </main>
  );
}
