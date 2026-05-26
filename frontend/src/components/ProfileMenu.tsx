"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { safeRouterPush } from "@/lib/safe-router";
import { ProfileModal, type ProfileModalSection } from "@/components/ProfileModal";
import { ThemeToggle } from "@/components/ThemeToggle";

type Props = {
  userName: string;
  userId?: string;
};

export function ProfileMenu({ userName, userId }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalSection, setModalSection] = useState<ProfileModalSection | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const displayName = userName || "Profile";
  const initials = userInitials(displayName);

  function openModal(section: ProfileModalSection) {
    setMenuOpen(false);
    setModalSection(section);
  }

  function closeModal() {
    setModalSection(null);
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await authClient.signOut();
      safeRouterPush(router, "/sign-in");
    } finally {
      setSigningOut(false);
    }
  }

  function onMenuBlur(event: React.FocusEvent) {
    if (menuRef.current?.contains(event.relatedTarget as Node | null)) return;
    if (event.relatedTarget === buttonRef.current) return;
    setMenuOpen(false);
  }

  return (
    <>
      <div className="profileMenuRoot" ref={menuRef}>
        <button
          type="button"
          ref={buttonRef}
          className={`sidebarProfileChip${menuOpen ? " sidebarProfileChip--open" : ""}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" className="sidebarAvatar">{initials}</span>
          <span className="sidebarProfileName">{displayName}</span>
          <span className="profileMenuChevron" aria-hidden>
            <ChevronIcon />
          </span>
        </button>

        {menuOpen ? (
          <div
            className="profileMenuPopover"
            role="menu"
            aria-label="Profile menu"
            onBlur={onMenuBlur}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMenuOpen(false);
                buttonRef.current?.focus();
              }
            }}
          >
            <button
              type="button"
              className="profileMenuItem"
              role="menuitem"
              onClick={() => openModal("profile")}
            >
              <UserIcon />
              <span>Profile</span>
            </button>
            <button
              type="button"
              className="profileMenuItem"
              role="menuitem"
              onClick={() => openModal("voice")}
            >
              <SparkleIcon />
              <span>Personalization</span>
            </button>
            <div className="profileMenuThemeRow" role="group" aria-label="Appearance">
              <span className="profileMenuThemeLabel">Appearance</span>
              <ThemeToggle compact />
            </div>
            <div className="profileMenuDivider" role="separator" />
            <button
              type="button"
              className="profileMenuItem profileMenuItem--danger"
              role="menuitem"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <LogoutIcon />
              <span>{signingOut ? "Signing out..." : "Log out"}</span>
            </button>
          </div>
        ) : null}
      </div>

      <ProfileModal
        open={modalSection !== null}
        section={modalSection ?? "profile"}
        defaultName={displayName}
        onClose={closeModal}
        onChangeSection={(s) => setModalSection(s)}
        userId={userId}
      />
    </>
  );
}

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase();
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="7" r="3.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 16.5C4.5 13.7 7 12.5 10 12.5C13 12.5 15.5 13.7 16.5 16.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 3L11.5 8.5L17 10L11.5 11.5L10 17L8.5 11.5L3 10L8.5 8.5L10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M12 4H15.5C16.0523 4 16.5 4.44772 16.5 5V15C16.5 15.5523 16.0523 16 15.5 16H12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 7L4 10L8 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10H4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
