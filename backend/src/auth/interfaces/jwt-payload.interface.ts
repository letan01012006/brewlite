export interface JwtPayload {
  sub: number;
  email: string | null;
  role: 'CUSTOMER' | 'BARISTA' | 'STAFF' | 'MANAGER';
}

export interface AuthUser {
  id: number;
  email: string | null;
  role: 'CUSTOMER' | 'BARISTA' | 'STAFF' | 'MANAGER';
}
