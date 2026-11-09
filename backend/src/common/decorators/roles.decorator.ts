import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ('CUSTOMER' | 'BARISTA' | 'MANAGER')[]) => SetMetadata(ROLES_KEY, roles);
