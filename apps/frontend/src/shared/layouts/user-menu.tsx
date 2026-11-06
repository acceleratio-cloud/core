"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, User } from "lucide-react"

import { getApiErrorMessage } from "@/api"
import { useAuth } from "@/modules/auth/providers/auth-provider"
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu"

const getInitials = (name?: string) => {
  const parts = name?.trim().split(/\s+/).filter(Boolean).slice(0, 2) ?? []

  return parts.length ? parts.map((part) => part[0]).join("").toUpperCase() : null
}

export const UserMenu = () => {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const initials = getInitials(user?.name)

  const onSignOut = async () => {
    if (isSigningOut) {
      return
    }

    setIsSigningOut(true)

    try {
      await signOut()
    } catch (error) {
      console.error(getApiErrorMessage(error))
    } finally {
      setIsSigningOut(false)
      router.replace("/auth")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={user?.name ? `${user.name} account menu` : "Account menu"}
        className="group rounded-full outline-none focus-visible:ring-2 focus-visible:ring-foreground/60 data-[popup-open]:ring-2 data-[popup-open]:ring-foreground/30"
      >
        <Avatar>
          <AvatarFallback className="bg-background text-foreground transition-colors group-hover:bg-muted">
            {initials ?? (
              <User aria-hidden="true" strokeWidth={1.75} className="size-4" />
            )}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-56">
        {user ? (
          <>
            <div className="px-2 py-1.5">
              <p className="truncate text-[13px] font-medium text-foreground">{user.name}</p>
              <p className="truncate text-[12px] text-muted-foreground">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuLinkItem href="/settings?tab=profile">
          <User aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-muted-foreground" />
          Profile
        </DropdownMenuLinkItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={onSignOut} disabled={isSigningOut}>
          <LogOut aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-muted-foreground" />
          {isSigningOut ? "Logging out..." : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
