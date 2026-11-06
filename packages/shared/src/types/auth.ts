export interface AuthUser {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  image: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  id: string;
  token: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface SessionResponse {
  session: AuthSession | null;
  user: AuthUser | null;
}

export interface AuthStatusResponse {
  initialized: boolean;
}

export interface SignUpEmailPayload {
  name: string;
  email: string;
  password: string;
}

export interface SignInEmailPayload {
  email: string;
  password: string;
}

export interface AuthUserResponse {
  user: AuthUser;
}

export interface SignOutResponse {
  success: boolean;
}

export interface ApiErrorResponse {
  status_code: number;
  message: string;
  code?: string;
}

export interface UpdateProfilePayload {
  name: string;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
  /** Sign out every other session after the change. Defaults to true. */
  revoke_other_sessions?: boolean;
}

export interface ChangePasswordResponse {
  success: boolean;
}

/** A session in the user's list. Never carries the bearer token. */
export interface AuthSessionSummary {
  id: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
  current: boolean;
}

export interface SessionListResponse {
  sessions: AuthSessionSummary[];
}
