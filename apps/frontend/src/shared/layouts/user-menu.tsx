"use client"

import { useRouter } from "next/navigation"
import { LogOut, User } from "lucide-react"

import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu"

type UserMenuProps = {
  name?: string
  email?: string
}

const getInitials = (name?: string) => {
  const parts = name?.trim().split(/\s+/).filter(Boolean).slice(0, 2) ?? []

  return parts.length ? parts.map((part) => part[0]).join("").toUpperCase() : null
}

export const UserMenu = ({ name, email }: UserMenuProps) => {
  const router = useRouter()
  const initials = getInitials(name)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={name ? `${name} account menu` : "Account menu"}
        className="group rounded-full outline-none focus-visible:ring-2 focus-visible:ring-foreground/50 data-[popup-open]:ring-2 data-[popup-open]:ring-foreground/50"
      >
        <Avatar>
          <AvatarFallback className="transition-colors group-hover:bg-accent">
            {initials ?? (
              <User aria-hidden="true" strokeWidth={1.75} className="size-4" />
            )}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-56">
        {name ? (
          <>
            <div className="px-2 py-1.5">
              <p className="truncate text-[13px] font-medium text-foreground">{name}</p>
              {email ? (
                <p className="truncate text-[12px] text-muted-foreground">{email}</p>
              ) : null}
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuLinkItem href="/profile">
          <User aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-muted-foreground" />
          Profile
        </DropdownMenuLinkItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => router.push("/auth")}>
          <LogOut aria-hidden="true" strokeWidth={1.75} className="size-3.5 text-muted-foreground" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
