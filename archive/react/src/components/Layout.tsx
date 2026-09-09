import { useEffect, useState, useRef, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEpixNet } from "../contexts/EpixNetContext";

const navLinks = [
  { to: "/", label: "Register", icon: PlusIcon },
  { to: "/search", label: "Search", icon: SearchIcon },
  { to: "/my-names", label: "My Names", icon: UserIcon },
  { to: "/prices", label: "Prices", icon: TagIcon },
  { to: "/stats", label: "Stats", icon: ChartIcon },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { theme } = useEpixNet();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(0);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  // Measure sidebar width when expanded so main content margin matches
  const measureSidebar = useCallback(() => {
    if (sidebarRef.current && !collapsed) {
      setSidebarWidth(sidebarRef.current.offsetWidth);
    }
  }, [collapsed]);

  useEffect(() => {
    measureSidebar();
    const observer = new ResizeObserver(measureSidebar);
    if (sidebarRef.current) observer.observe(sidebarRef.current);
    return () => observer.disconnect();
  }, [measureSidebar]);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`fixed top-0 left-0 h-full bg-card border-r border-default flex flex-col z-20 transition-all duration-200 ${
          collapsed ? "w-14" : "w-fit"
        }`}
      >
        {/* Top: Wallet — sizes sidebar to fit, stays visible when collapsed */}
        <div className="border-b border-default p-2 shrink-0 overflow-visible">
          <div className="[&>div]:!flex-wrap [&>div]:!gap-1.5 [&_button]:!text-xs">
            <ConnectButton showBalance chainStatus="icon" />
          </div>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {navLinks.map((link) => {
            const active = location.pathname === link.to;
            const Icon = link.icon;
            return (
              <Link
                key={link.to}
                to={link.to}
                title={collapsed ? link.label : undefined}
                className={`flex items-center gap-3 rounded-md text-sm font-medium transition-colors ${
                  collapsed ? "justify-center px-0 py-2" : "px-3 py-2"
                } ${
                  active
                    ? "bg-accent-subtle text-accent"
                    : "text-secondary hover:text-primary hover:bg-hover"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span className="truncate">{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: collapse toggle */}
        <div className="border-t border-default p-2 shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`flex items-center gap-3 w-full rounded-md text-sm font-medium text-secondary hover:text-primary hover:bg-hover transition-colors ${
              collapsed ? "justify-center py-2" : "px-3 py-2"
            }`}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <CollapseIcon collapsed={collapsed} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div
        className="flex-1 min-h-screen transition-all duration-200"
        style={{ marginLeft: collapsed ? 56 : sidebarWidth || 56 }}
      >
        <main className="max-w-4xl mx-auto px-6 py-10">{children}</main>
      </div>
    </div>
  );
}

/* ── Inline SVG Icons (minimal, Stripe-style) ──────────────────────── */

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    </svg>
  );
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2z" />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 13V8M7 13V5M11 13V3" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {collapsed ? (
        <path d="M6 3l5 5-5 5" />
      ) : (
        <path d="M10 3L5 8l5 5" />
      )}
    </svg>
  );
}
