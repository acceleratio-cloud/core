import { api } from "@/api";
import type {
  ApiErrorResponse,
  AuthStatusResponse,
  AuthUserResponse,
  SessionResponse,
  SignInEmailPayload,
  SignOutResponse,
  SignUpEmailPayload,
} from "@acceleratio/shared";

export const authApi = {
  status: async () => {
    const { data } = await api.get<AuthStatusResponse>("/auth/status");
    return data;
  },
  getSession: async () => {
    const { data } = await api.get<SessionResponse>("/auth/session");
    return data;
  },
  signUpEmail: async (payload: SignUpEmailPayload) => {
    const { data } = await api.post<AuthUserResponse>(
      "/auth/sign-up/email",
      payload,
    );
    return data;
  },
  signInEmail: async (payload: SignInEmailPayload) => {
    const { data } = await api.post<AuthUserResponse>(
      "/auth/sign-in/email",
      payload,
    );
    return data;
  },
  signOut: async () => {
    const { data } = await api.post<SignOutResponse>("/auth/sign-out");
    return data;
  },
};

export type { ApiErrorResponse };
