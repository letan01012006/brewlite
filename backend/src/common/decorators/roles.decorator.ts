import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ('CUSTOMER' | 'BARISTA' | 'STAFF' | 'MANAGER')[]) => SetMetadata(ROLES_KEY, roles);
