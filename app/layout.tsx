import type { Metadata } from "next";
import { JetBrains_Mono, Source_Sans_3 } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AppShell, SidebarProvider } from "@/components/sidebar";
import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import UpdateBanner from "@/components/update-banner";
import MathCopy from "@/components/math-copy";
import { MODE_CACHE_KEY } from "@/components/settings/mode";

// Runs before first paint: a user whose last mode was light (or "system"
// on a light OS) gets <html class="light"> immediately instead of a dark
// flash until /api/settings answers. The provider keeps the cache current.
const MODE_BOOT_SCRIPT = `try{var m=localStorage.getItem(${JSON.stringify(MODE_CACHE_KEY)});if(m==="light"||(m==="system"&&matchMedia("(prefers-color-scheme: light)").matches)){var r=document.documentElement;r.classList.remove("dark");r.classList.add("light");r.style.colorScheme="light"}}catch(e){}`;

// Chrome = JetBrains Mono, teaching prose = Source Sans 3, titles = CMU
// Serif (the bundled lh-cmu @font-face in globals.css — no CDN).
const ui = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });
const prose = Source_Sans_3({ subsets: ["latin"], variable: "--font-sans3" });

export const metadata: Metadata = {
	title: "Learning Harness",
	description: "A teacher agent with a memory — sessions, quizzes, and a knowledge graph of what you know.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`dark ${ui.variable} ${prose.variable}`} suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: MODE_BOOT_SCRIPT }} />
			</head>
			<body className="min-h-dvh antialiased">
			{/* The notification channel rides OUTSIDE everything: sidebar, dock,
				 and pages all subscribe as the polls retire (push S3, 2026-10-02). */}
			<ServerEventsProvider>
				<AppearanceProvider>
					<SidebarProvider>
						<ActivityProvider>
							<AppShell>{children}</AppShell>
						</ActivityProvider>
					</SidebarProvider>
				</AppearanceProvider>
			</ServerEventsProvider>
			{/* Auto-update banner (Wave C): fixed card, Electron-only pushes. */}
			<UpdateBanner />
			{/* Copying a selection that spans KaTeX yields TeX ($…$), not MathML soup. */}
			<MathCopy />
		</body>
		</html>
	);
}
