import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ('CUSTOMER' | 'BARISTA')[]) => SetMetadata(ROLES_KEY, roles);
