import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { playApi } from '../../../services/play-api';
import type { AdminSession } from '../../../types/play';

const apiMode = import.meta.env.VITE_API_MODE ?? (import.meta.env.DEV ? 'local' : 'remote');
const isLocalDevMode = import.meta.env.DEV && apiMode === 'local';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    playApi.getAdminSession().then((session: AdminSession | null) => {
      if (session) {
        navigate('/admin/review');
      }
    });
  }, [navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await playApi.adminLogin(username.trim(), password.trim());
      navigate('/admin/review');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="centered-shell">
      <div className="login-grid">
        <form className="login-panel stack-gap-lg" onSubmit={handleSubmit}>
          <div>
            <p className="eyebrow">Admin Access</p>
            <h2>管理员登录</h2>
          </div>

          <label>
            <span>账号</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={isLocalDevMode ? '本地演示可随便填一个名字' : '输入管理员账号'}
            />
          </label>

          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isLocalDevMode ? '本地演示任意非空密码' : '输入管理员密码'}
            />
          </label>

          <button className="button primary" disabled={submitting} type="submit">
            {submitting ? '登录中...' : '进入审核后台'}
          </button>

          {error ? <div className="feedback error">{error}</div> : null}

          <div className="login-meta">
            <Link to="/plays" className="text-link">
              返回游客页
            </Link>
          </div>
        </form>
      </div>
    </section>
  );
}