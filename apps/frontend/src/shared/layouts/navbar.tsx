"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useSyncExternalStore } from "react"
import { House, Search, Server, Settings, Store } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Separator } from "@/shared/components/ui/separator"
import { Kbd } from "../components/ui/kbd"
import { LogoIcon } from "../icons/logo-icon"
import { UserMenu } from "./user-menu"

type NavLink = {
  label: string
  href: string
  icon: LucideIcon
}

const links: NavLink[] = [
  { label: "Overview", href: "/", icon: House },
  { label: "Marketplace", href: "/marketplace", icon: Store },
  { label: "Servers", href: "/servers", icon: Server },
  { label: "Settings", href: "/settings", icon: Settings },
]

const isActivePath = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)

const subscribeToPlatform = () => () => {}

const useIsApplePlatform = () =>
  useSyncExternalStore(
    subscribeToPlatform,
    () => /mac|iphone|ipad/i.test(navigator.userAgent),
    () => true,
  )

export const Navbar = () => {
  const pathname = usePathname()
  const searchRef = useRef<HTMLInputElement>(null)
  const isApple = useIsApplePlatform()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) {
        return
      }

      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div className="flex h-full items-center gap-3 px-4">
      <Link
        href="/"
        aria-label="Acceleratio home"
        className="flex shrink-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <LogoIcon className="size-5 fill-primary-foreground" />
        <span className="hidden text-[13px] font-medium tracking-wide text-primary-foreground sm:inline">
          cceleratio
          <span className="text-[11px] text-primary-foreground/75">.cloud</span>
        </span>
      </Link>

      <Separator
        orientation="vertical"
        className="mx-0.5 h-4 self-center! bg-white/15"
      />

      <nav aria-label="Primary" className="flex min-w-0 items-center gap-1.5">
        {links.map((link) => (
          <NavItem key={link.href} link={link} active={isActivePath(pathname, link.href)} />
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <div
          role="search"
          className="hidden h-8 w-64 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 transition-[border-color,box-shadow] focus-within:border-white/40 focus-within:ring-3 focus-within:ring-white/10 lg:flex"
        >
          <Search
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-3.5 shrink-0 text-primary-foreground/50"
          />
          <input
            ref={searchRef}
            type="text"
            aria-label="Quick search"
            aria-keyshortcuts="Meta+K Control+K"
            autoComplete="off"
            spellCheck={false}
            placeholder="Quick search..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-primary-foreground outline-none placeholder:text-primary-foreground/50"
          />
          <Kbd className="bg-white/10 text-primary-foreground/60">
            {isApple ? "⌘K" : "Ctrl K"}
          </Kbd>
        </div>

        <UserMenu />
      </div>
    </div>
  )
}

const NavItem = ({ link, active }: { link: NavLink; active: boolean }) => {
  const Icon = link.icon

  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/70",
        active
          ? "bg-white/10 font-medium text-primary-foreground"
          : "text-primary-foreground/70 hover:bg-white/5 hover:text-primary-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={1.75}
        className={cn(
          "size-3.5 shrink-0",
          active ? "text-primary-foreground" : "text-primary-foreground/50",
        )}
      />
      <span className="sr-only sm:not-sr-only sm:truncate">{link.label}</span>
    </Link>
  )
}
