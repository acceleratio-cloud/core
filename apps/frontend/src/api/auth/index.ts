import { api } from "@/api";
import type {
  AcceptInvitePayload,
  ApiErrorResponse,
  AuthStatusResponse,
  AuthUser,
  AuthUserResponse,
  ChangePasswordPayload,
  ChangePasswordResponse,
  InvitePreview,
  SessionListResponse,
  SessionResponse,
  SignInEmailPayload,
  SignOutResponse,
  SignUpEmailPayload,
  UpdateProfilePayload,
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
  updateProfile: async (payload: UpdateProfilePayload) => {
    const { data } = await api.patch<AuthUser>("/auth/profile", payload);
    return data;
  },
  changePassword: async (payload: ChangePasswordPayload) => {
    const { data } = await api.post<ChangePasswordResponse>(
      "/auth/change-password",
      payload,
    );
    return data;
  },
  listSessions: async () => {
    const { data } = await api.get<SessionListResponse>("/auth/sessions");
    return data;
  },
  revokeSession: async (id: string) => {
    const { data } = await api.delete<ChangePasswordResponse>(
      `/auth/sessions/${encodeURIComponent(id)}`,
    );
    return data;
  },
  revokeOtherSessions: async () => {
    const { data } = await api.delete<ChangePasswordResponse>(
      "/auth/sessions/others",
    );
    return data;
  },
  getInvite: async (token: string) => {
    const { data } = await api.get<InvitePreview>(
      `/auth/invites/${encodeURIComponent(token)}`,
    );
    return data;
  },
  acceptInvite: async (token: string, payload: AcceptInvitePayload) => {
    const { data } = await api.post<AuthUserResponse>(
      `/auth/invites/${encodeURIComponent(token)}/accept`,
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
