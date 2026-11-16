"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import type {
  AuthUser,
  MemberAccess,
  SignInEmailPayload,
  SignUpEmailPayload,
} from "@acceleratio/shared"

import { authApi } from "@/api/auth"

interface AuthContextValue {
  user: AuthUser | null
  /** What the signed-in account may do; null while signed out or loading. */
  access: MemberAccess | null
  isPending: boolean
  refresh: () => Promise<AuthUser | null>
  signIn: (payload: SignInEmailPayload) => Promise<AuthUser>
  signUp: (payload: SignUpEmailPayload) => Promise<AuthUser>
  signOut: () => Promise<void>
  updateName: (name: string) => Promise<AuthUser>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [access, setAccess] = useState<MemberAccess | null>(null)
  const [isPending, setIsPending] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const session = await authApi.getSession()
      setUser(session.user)
      setAccess(session.access)
      return session.user
    } catch {
      setUser(null)
      setAccess(null)
      return null
    }
  }, [])

  useEffect(() => {
    let active = true

    authApi
      .getSession()
      .then((session) => {
        if (active) {
          setUser(session.user)
          setAccess(session.access)
        }
      })
      .catch(() => {
        if (active) {
          setUser(null)
          setAccess(null)
        }
      })
      .finally(() => {
        if (active) {
          setIsPending(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const signIn = useCallback(
    async (payload: SignInEmailPayload) => {
      const { user: signedInUser } = await authApi.signInEmail(payload)
      setUser(signedInUser)
      // The role comes with the session, not with the sign-in response.
      await refresh()
      return signedInUser
    },
    [refresh],
  )

  const signUp = useCallback(
    async (payload: SignUpEmailPayload) => {
      const { user: createdUser } = await authApi.signUpEmail(payload)
      setUser(createdUser)
      await refresh()
      return createdUser
    },
    [refresh],
  )

  const signOut = useCallback(async () => {
    await authApi.signOut()
    setUser(null)
    setAccess(null)
  }, [])

  const updateName = useCallback(async (name: string) => {
    const updated = await authApi.updateProfile({ name })
    setUser(updated)
    return updated
  }, [])

  const value = useMemo(
    () => ({
      user,
      access,
      isPending,
      refresh,
      signIn,
      signUp,
      signOut,
      updateName,
    }),
    [user, access, isPending, refresh, signIn, signUp, signOut, updateName],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }

  return context
}
