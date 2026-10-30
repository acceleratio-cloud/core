import "server-only";

import type {
  AuthStatusResponse,
  SessionResponse,
} from "@acceleratio/shared";
import { cookies } from "next/headers";

import { api } from "@/api";
import { authApi } from "@/api/auth";

export const getAuthStatus = async (): Promise<AuthStatusResponse | null> => {
  try {
    return await authApi.status();
  } catch {
    return null;
  }
};

export const getServerSession = async (): Promise<SessionResponse | null> => {
  try {
    const cookieStore = await cookies();
    const { data } = await api.get<SessionResponse>("/auth/session", {
      headers: { cookie: cookieStore.toString() },
    });

    return data;
  } catch {
    return null;
  }
};
