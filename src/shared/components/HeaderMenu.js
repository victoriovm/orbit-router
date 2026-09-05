"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useRouter } from "next/navigation";

function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
        danger
          ? "text-red-500 hover:bg-red-500/10"
          : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      <span className={`material-symbols-outlined text-[20px] ${danger ? "" : "text-text-muted"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-bg text-text-muted hover:border-primary/40 hover:text-text-main hover:bg-bg-hover transition-all"
        title="Menu"
      >
        <span className="material-symbols-outlined text-[20px] leading-none">person</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-60 bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 overflow-hidden py-1">
          <div className="mb-1 flex items-center gap-3 border-b border-border px-4 py-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-bg text-primary">
              <span className="material-symbols-outlined text-[24px] leading-none">person</span>
            </div>
            <p className="text-sm font-semibold text-text-main">Local User</p>
          </div>
          <MenuItem
            icon="settings"
            label="Settings"
            onClick={() => { close(); router.push("/dashboard/profile"); }}
          />
          <MenuItem
            icon="logout"
            label="Logout"
            danger
            onClick={() => { close(); onLogout(); }}
          />
        </div>
      )}
    </div>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
