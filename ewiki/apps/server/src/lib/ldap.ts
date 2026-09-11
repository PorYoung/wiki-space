// ---------------------------------------------------------------------------
// 企业 LDAP 自动登录（预留接口，本期不实现）：
//   预留点：users.sso_subject 字段（外部主体映射）、/auth/ldap/* 路由、本适配器接口。
//   启用路径：实现 bind/search 逻辑（ldapts 等库）→ 注册/登录时 upsert 用户（ssoSubject 落库）
//   → env LDAP_URL/LDAP_BIND_DN/LDAP_SEARCH_BASE 配置 → auth/ldap/status 返回 enabled:true。
// ---------------------------------------------------------------------------

export interface LdapBindResult {
  ok: boolean;
  username?: string;
  displayName?: string;
  email?: string;
  dn?: string;
  message?: string;
}

export const LDAP_ENABLED = false;

export async function ldapAutoLogin(_username: string, _password: string): Promise<LdapBindResult> {
  return {
    ok: false,
    message: '企业 LDAP 自动登录为预留能力，本期未启用；请使用邮箱注册后登录。',
  };
}
