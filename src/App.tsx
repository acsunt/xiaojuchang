import { useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { playApi } from './services/play-api';
import { useUpdateNotifier } from './hooks/useUpdateNotifier';
import { ChangelogModal } from './components/ChangelogModal';
import { UpdatePromptModal } from './components/UpdatePromptModal';
import {
  getOwnedPlayIds,
  getRepoNoticeSettings,
  getRepoReadAt,
  getVisitorId,
  REPO_NOTICE_UPDATED_EVENT,
} from './services/browser-repo-history';
import {
  getPlazaToolbarCollapsed,
  setPlazaToolbarCollapsed,
  PLAZA_TOOLBAR_UPDATED_EVENT,
} from './services/browser-play-preferences';
import { OPEN_CHANGELOG_EVENT } from './data/visitor-changelog';
import type { RepoNoticeSettings, SiteSettings } from './types/play';
import { PlayDetailPage } from './pages/plays/PlayDetailPage';
import { PlayListPage } from './pages/plays/PlayListPage';
import { UploadPage } from './pages/upload/UploadPage';
import { AdminLoginPage } from './pages/admin/login/AdminLoginPage';
import { AdminReviewPage } from './pages/admin/review/AdminReviewPage';
import { RepoPage } from './pages/repos/RepoPage';

const publicNavItems = [
  { to: '/plays', label: '广场' },
  { to: '/upload', label: '上传小剧场' },
];

const THEME_STORAGE_KEY = 'mini-theater.theme';
type ThemeMode = 'light' | 'dark';

const createDefaultBackground = (overlayOpacity: number) => ({
  backgroundUrl: '',
  crop: {
    positionX: 50,
    positionY: 50,
    scale: 100,
    backgroundOpacity: 1,
    overlayOpacity,
  },
});

const defaultSiteSettings: SiteSettings = {
  light: {
    desktop: createDefaultBackground(0.2),
    mobile: createDefaultBackground(0.2),
  },
  dark: {
    desktop: createDefaultBackground(0.32),
    mobile: createDefaultBackground(0.32),
  },
  createdAt: '',
  updatedAt: '',
};

const readStoredTheme = (): ThemeMode => {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(defaultSiteSettings);
  const [repoNoticeSettings, setRepoNoticeSettingsState] = useState<RepoNoticeSettings>(() => getRepoNoticeSettings());
  const [repoUnreadCount, setRepoUnreadCount] = useState(0);
  const [plazaToolbarCollapsed, setPlazaToolbarCollapsedState] = useState(() => getPlazaToolbarCollapsed());
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [backgroundDevice, setBackgroundDevice] = useState<'desktop' | 'mobile'>('desktop');
  const { updateAvailable, dismiss: dismissUpdate, refresh: refreshUpdate } = useUpdateNotifier();

  useEffect(() => {
    document.title = '小剧场';
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const syncDevice = () => {
      setBackgroundDevice(mediaQuery.matches ? 'mobile' : 'desktop');
    };

    syncDevice();
    mediaQuery.addEventListener('change', syncDevice);

    return () => {
      mediaQuery.removeEventListener('change', syncDevice);
    };
  }, []);

  useEffect(() => {
    void playApi
      .getSiteSettings()
      .then(setSiteSettings)
      .catch(() => setSiteSettings(defaultSiteSettings));
  }, []);

  useEffect(() => {
    const refreshRepoNotice = () => {
      const settings = getRepoNoticeSettings();
      setRepoNoticeSettingsState(settings);
      if (settings === 'off') {
        setRepoUnreadCount(0);
        return;
      }

      void playApi
        .getRepoNoticeSummary(getOwnedPlayIds(), getVisitorId(), getRepoReadAt())
        .then((summary) => setRepoUnreadCount(summary.unreadCount))
        .catch(() => setRepoUnreadCount(0));
    };

    refreshRepoNotice();
    window.addEventListener('focus', refreshRepoNotice);
    window.addEventListener('storage', refreshRepoNotice);
    window.addEventListener(REPO_NOTICE_UPDATED_EVENT, refreshRepoNotice);
    return () => {
      window.removeEventListener('focus', refreshRepoNotice);
      window.removeEventListener('storage', refreshRepoNotice);
      window.removeEventListener(REPO_NOTICE_UPDATED_EVENT, refreshRepoNotice);
    };
  }, [location.pathname]);

  useEffect(() => {
    const syncToolbarCollapsed = () => {
      setPlazaToolbarCollapsedState(getPlazaToolbarCollapsed());
    };

    window.addEventListener('storage', syncToolbarCollapsed);
    window.addEventListener(PLAZA_TOOLBAR_UPDATED_EVENT, syncToolbarCollapsed);
    return () => {
      window.removeEventListener('storage', syncToolbarCollapsed);
      window.removeEventListener(PLAZA_TOOLBAR_UPDATED_EVENT, syncToolbarCollapsed);
    };
  }, []);

  useEffect(() => {
    const openChangelog = () => {
      setChangelogOpen(true);
    };

    window.addEventListener(OPEN_CHANGELOG_EVENT, openChangelog);
    return () => {
      window.removeEventListener(OPEN_CHANGELOG_EVENT, openChangelog);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);

    const activeBackground = siteSettings[theme][backgroundDevice];
    document.documentElement.style.setProperty(
      '--app-bg-image',
      activeBackground.backgroundUrl ? `url("${activeBackground.backgroundUrl}")` : 'none',
    );
    document.documentElement.style.setProperty(
      '--app-bg-position',
      `${activeBackground.crop.positionX}% ${activeBackground.crop.positionY}%`,
    );
    document.documentElement.style.setProperty('--app-bg-size', `${activeBackground.crop.scale}%`);
    document.documentElement.style.setProperty(
      '--app-bg-opacity',
      `${activeBackground.crop.backgroundOpacity ?? 1}`,
    );
    document.documentElement.style.setProperty(
      '--app-bg-overlay',
      `${activeBackground.crop.overlayOpacity}`,
    );
  }, [backgroundDevice, siteSettings, theme]);

  const themeLabel = useMemo(() => (theme === 'dark' ? '切换日间' : '切换夜间'), [theme]);
  const plazaPanel = location.pathname === '/plays' ? new URLSearchParams(location.search).get('panel') : '';
  const calendarNavActive = plazaPanel === 'calendar';
  const derivedNavActive = plazaPanel === 'derived';
  const openPlazaPanel = (panel: 'calendar' | 'derived') => {
    const search = plazaPanel === panel ? '' : `?panel=${panel}`;
    navigate({ pathname: '/plays', search });
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-actions">
          <nav className="top-nav">
            <button
              aria-label={plazaToolbarCollapsed ? '展开广场筛选和工具栏' : '折叠广场筛选和工具栏'}
              className={plazaToolbarCollapsed ? 'icon-button header-toolbar-toggle active' : 'icon-button header-toolbar-toggle'}
              onClick={() => setPlazaToolbarCollapsedState(setPlazaToolbarCollapsed(!plazaToolbarCollapsed))}
              title={plazaToolbarCollapsed ? '展开广场筛选和工具栏' : '折叠广场筛选和工具栏'}
              type="button"
            >
              {plazaToolbarCollapsed ? '▸' : '▾'}
            </button>
            <NavLink to="/repos" className={({ isActive }) => (isActive ? 'nav-pill active repo-nav-pill' : 'nav-pill repo-nav-pill')}>
              repo
              {repoNoticeSettings === 'count' && repoUnreadCount > 0 ? (
                <span className="repo-nav-badge">{repoUnreadCount}</span>
              ) : null}
              {repoNoticeSettings === 'dot' && repoUnreadCount > 0 ? <span className="repo-nav-dot" /> : null}
            </NavLink>
            <button
              className={derivedNavActive ? 'nav-pill active' : 'nav-pill'}
              onClick={() => openPlazaPanel('derived')}
              type="button"
            >
              衍生
            </button>
            <button
              className={calendarNavActive ? 'nav-pill active' : 'nav-pill'}
              onClick={() => openPlazaPanel('calendar')}
              type="button"
            >
              新增
            </button>
            {publicNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'nav-pill active' : 'nav-pill')}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button
            aria-label={themeLabel}
            className="icon-button header-theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            type="button"
            title={themeLabel}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="page-shell">
        <Routes>
          <Route path="/" element={<PlayListPage />} />
          <Route path="/plays" element={<PlayListPage />} />
          <Route path="/plays/:id" element={<PlayDetailPage />} />
          <Route path="/repos" element={<RepoPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/review" element={<AdminReviewPage />} />
        </Routes>
      </main>

      {updateAvailable ? (
        <UpdatePromptModal onCancel={dismissUpdate} onRefresh={refreshUpdate} />
      ) : null}

      {changelogOpen ? <ChangelogModal onClose={() => setChangelogOpen(false)} /> : null}
    </div>
  );
}