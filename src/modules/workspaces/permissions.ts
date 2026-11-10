export const ROLES = ["owner", "admin", "editor", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const READ = ["workspace:read", "members:read", "content:read", "accounts:read", "media:read", "campaigns:read", "calendar:read"] as const;
const ANALYTICS = ["analytics:read", "reports:export"] as const;
const WRITE = ["content:write", "media:write", "campaigns:write", "publish:create", "publish:cancel"] as const;
const ADMIN = ["workspace:update", "members:manage", "accounts:manage", "audit:read", "approvals:decide"] as const;

const BILLING_READ = ["billing:read"] as const;
const BILLING_MANAGE = ["billing:manage"] as const;

export type Permission = (typeof READ)[number] | (typeof ANALYTICS)[number] | (typeof WRITE)[number] | (typeof ADMIN)[number] | (typeof BILLING_READ)[number] | (typeof BILLING_MANAGE)[number] | "workspace:delete";

export const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set([...READ, ...ANALYTICS, ...WRITE, ...ADMIN, ...BILLING_READ, ...BILLING_MANAGE, "workspace:delete"]),
  admin: new Set([...READ, ...ANALYTICS, ...WRITE, ...ADMIN, ...BILLING_READ]),
  editor: new Set([...READ, ...ANALYTICS, ...WRITE]),
  analyst: new Set([...READ, ...ANALYTICS]),
  viewer: new Set([...READ]),
};
export const can = (role: Role, p: Permission) => PERMISSIONS[role].has(p);

/** Who may grant/modify/remove which role: owners anything; admins only roles strictly below admin. */
export const canManageRole = (actor: Role, target: Role) => actor === "owner" || (actor === "admin" && ROLES.indexOf(target) > ROLES.indexOf("admin"));
