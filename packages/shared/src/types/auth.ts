export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
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
  statusCode: number;
  message: string;
  code?: string;
}
