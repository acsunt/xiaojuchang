import { getAdminSessionFromRequest, getSiteSettings, updateSiteSettings } from '../../_lib/db';
import { error, json } from '../../_lib/http';

type BackgroundDevicePayload = {
  backgroundUrl?: string;
  crop?: {
    positionX?: number;
    positionY?: number;
    scale?: number;
    backgroundOpacity?: number;
    overlayOpacity?: number;
  };
};

type ThemeBackgroundPayload = BackgroundDevicePayload & {
  desktop?: BackgroundDevicePayload;
  mobile?: BackgroundDevicePayload;
};

type SiteSettingsPayload = {
  light?: ThemeBackgroundPayload;
  dark?: ThemeBackgroundPayload;
};

const normalizeBackgroundDevicePayload = (
  payload: BackgroundDevicePayload | undefined,
  overlayOpacity: number,
) => ({
  backgroundUrl: String(payload?.backgroundUrl ?? ''),
  crop: {
    positionX: Number(payload?.crop?.positionX ?? 50),
    positionY: Number(payload?.crop?.positionY ?? 50),
    scale: Number(payload?.crop?.scale ?? 100),
    backgroundOpacity: Number(payload?.crop?.backgroundOpacity ?? 1),
    overlayOpacity: Number(payload?.crop?.overlayOpacity ?? overlayOpacity),
  },
});

const normalizeThemeBackgroundPayload = (
  payload: ThemeBackgroundPayload | undefined,
  overlayOpacity: number,
) => {
  const legacyBackground = normalizeBackgroundDevicePayload(payload, overlayOpacity);
  return {
    desktop: normalizeBackgroundDevicePayload(payload?.desktop ?? legacyBackground, overlayOpacity),
    mobile: normalizeBackgroundDevicePayload(payload?.mobile ?? legacyBackground, overlayOpacity),
  };
};

export const onRequestGet: PagesFunction = async ({ env, request }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  try {
    const settings = await getSiteSettings(env.DB);
    return json(settings);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '站点外观配置加载失败', 500);
  }
};

export const onRequestPut: PagesFunction = async ({ env, request }) => {
  const session = await getAdminSessionFromRequest(env.DB, request);
  if (!session) {
    return error('管理员未登录', 401);
  }

  const body = (await request.json()) as SiteSettingsPayload;

  try {
    const settings = await updateSiteSettings(env.DB, {
      light: normalizeThemeBackgroundPayload(body.light, 0.2),
      dark: normalizeThemeBackgroundPayload(body.dark, 0.32),
    });

    return json(settings);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '站点外观配置保存失败');
  }
};
