export interface JwtPayload {
  sub: number;
  email: string | null;
  role: 'CUSTOMER' | 'BARISTA' | 'MANAGER';
}

export interface AuthUser {
  id: number;
  email: string | null;
  role: 'CUSTOMER' | 'BARISTA' | 'MANAGER';
}
