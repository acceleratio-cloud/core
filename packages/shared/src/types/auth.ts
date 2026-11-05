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
