import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { apiFetch, tokenStore } from '../lib/api/client';

/** 登录/注册页（真实 API：POST /api/v1/auth/login | /api/v1/auth/register）
 *  注册成功即自动创建个人示例知识库；企业 LDAP 自动登录为预留接口（本期开放邮箱注册）。 */

type Mode = 'login' | 'register';

export function LoginPage(): React.ReactElement {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    // 邮箱与后端归一化保持一致（trim + 小写），避免"注册用的邮箱"和"登录输的邮箱"因大小写/空格对不上
    const normalizedEmail = email.trim().toLowerCase();
    try {
      if (mode === 'login') {
        const data = await apiFetch<{ accessToken: string; refreshToken: string }>('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: normalizedEmail, password }),
        });
        tokenStore.set(data.accessToken, data.refreshToken);
      } else {
        const data = await apiFetch<{ accessToken: string; refreshToken: string }>('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email: normalizedEmail, password, name }),
        });
        tokenStore.set(data.accessToken, data.refreshToken);
      }
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      // 常见错误转人话；其余展示后端消息（注册类校验消息已是中文）
      const friendly
        = raw.includes('UNAUTHENTICATED') ? '邮箱或密码不正确。请检查邮箱是否与注册时一致（可在注册页重试确认）。'
        : raw.includes('EMAIL_EXISTS') ? '该邮箱已注册，请直接登录。'
        : raw.includes('USER_NOT_FOUND') ? '该邮箱尚未注册。'
        : raw || (mode === 'login' ? '登录失败，请重试' : '注册失败，请重试');
      setError(friendly);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center" style={{ background: 'var(--bg-page)' }}>
      <div className="card w-full max-w-sm p-8 animate-fade-up">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ background: 'var(--color-primary-500)' }}>
            <BookOpen size={20} />
          </div>
          <div>
            <div className="text-lg font-bold font-display">ewiki</div>
            <div className="text-xs" style={{ color: 'var(--text-muted, #64748b)' }}>文档知识管理平台</div>
          </div>
        </div>

        <div className="mb-4 flex rounded-lg border p-1 text-sm" style={{ borderColor: 'var(--border-soft)' }}>
          {(['login', 'register'] as const).map((m) => (
            <button key={m} type="button"
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${mode === m ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-800'}`}
              onClick={() => { setMode(m); setError(null); }}>
              {m === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium" htmlFor="name">姓名</label>
              <input id="name" type="text" className="input" value={name} autoComplete="name"
                onChange={(e) => setName(e.target.value)} placeholder="用于展示与示例知识库命名" required />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="email">邮箱</label>
            <input id="email" type="email" className="input" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} placeholder={mode === 'login' ? 'admin@ewiki.local' : 'you@company.com'} required />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="password">密码</label>
            <input id="password" type="password" className="input" value={password} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? '至少 8 位' : undefined} required />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? (mode === 'login' ? '登录中…' : '注册中…') : mode === 'login' ? '登录' : '注册并进入平台'}
          </button>
        </form>
        {mode === 'register' && (
          <p className="mt-3 rounded-lg bg-primary-50 p-2.5 text-xs text-primary-700">
            注册成功后将自动创建你的个人示例知识库。
          </p>
        )}
        <p className="mt-4 text-xs" style={{ color: 'var(--text-muted, #94a3b8)' }}>
          企业账号（LDAP 自动登录）：预留接口，本期开放邮箱注册。
        </p>
      </div>
    </div>
  );
}
