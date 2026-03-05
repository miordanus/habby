"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV = [
  { href: "/",          label: "Home",     icon: "🏠" },
  { href: "/checkin",   label: "Log",      icon: "✏️" },
  { href: "/timeline",  label: "Timeline", icon: "📊" },
  { href: "/goals",     label: "Goals",    icon: "🎯" },
  { href: "/stats",     label: "Stats",    icon: "📈" },
]

export default function NavBar() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-stretch max-w-xl mx-auto">
        {NAV.map(({ href, label, icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-mono transition-colors ${
                active
                  ? "text-[#00FF85]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <span className="text-lg leading-none">{icon}</span>
              <span className="uppercase tracking-wider">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
