export interface JwtPayload {
  sub: number;
  email: string;
  role: 'CUSTOMER' | 'BARISTA';
}

export interface AuthUser {
  id: number;
  email: string;
  role: 'CUSTOMER' | 'BARISTA';
}
