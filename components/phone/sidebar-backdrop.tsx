"use client";

import type { SidebarDrawer } from "./use-sidebar-drawer";

/** The dimmed page behind an open drawer: a tap on it closes the drawer. */
export function SidebarBackdrop({ drawer }: { drawer: SidebarDrawer }) {
	if (!drawer.active || !drawer.open) return null;
	return <div data-testid="sidebar-backdrop" aria-hidden="true" className="fixed inset-0 z-[44] bg-background/60" onClick={drawer.close} />;
}
