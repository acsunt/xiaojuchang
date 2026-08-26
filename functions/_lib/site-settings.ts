import { normalizeSiteSettings, now } from './http';
import { clamp } from './db-utils';

type BackgroundCropDraft = {
  positionX: number;
  positionY: number;
  scale: number;
  backgroundOpacity: number;
  overlayOpacity: number;
};

type BackgroundDeviceDraft = {
  backgroundUrl: string;
  crop: BackgroundCropDraft;
};

type ThemeBackgroundDraft = {
  desktop: BackgroundDeviceDraft;
  mobile: BackgroundDeviceDraft;
};

type SiteSettingsDraft = {
  light: ThemeBackgroundDraft;
  dark: ThemeBackgroundDraft;
};

const normalizeBackgroundDeviceDraft = (draft: BackgroundDeviceDraft, overlayOpacity: number) => ({
  backgroundUrl: String(draft.backgroundUrl ?? '').trim(),
  crop: {
    positionX: clamp(Number(draft.crop.positionX ?? 50), 0, 100),
    positionY: clamp(Number(draft.crop.positionY ?? 50), 0, 100),
    scale: clamp(Number(draft.crop.scale ?? 100), 100, 240),
    backgroundOpacity: clamp(Number(draft.crop.backgroundOpacity ?? 1), 0, 1),
    overlayOpacity: clamp(Number(draft.crop.overlayOpacity ?? overlayOpacity), 0, 0.9),
  },
});

const normalizeThemeBackgroundDraft = (draft: ThemeBackgroundDraft, overlayOpacity: number) => ({
  desktop: normalizeBackgroundDeviceDraft(draft.desktop, overlayOpacity),
  mobile: normalizeBackgroundDeviceDraft(draft.mobile, overlayOpacity),
});

const normalizeSiteSettingsDraft = (draft: SiteSettingsDraft) => {
  const light = normalizeThemeBackgroundDraft(draft.light, 0.2);
  const dark = normalizeThemeBackgroundDraft(draft.dark, 0.32);

  return {
    lightBackgroundUrl: JSON.stringify(light),
    lightPositionX: light.desktop.crop.positionX,
    lightPositionY: light.desktop.crop.positionY,
    lightScale: light.desktop.crop.scale,
    lightOverlayOpacity: light.desktop.crop.overlayOpacity,
    darkBackgroundUrl: JSON.stringify(dark),
    darkPositionX: dark.desktop.crop.positionX,
    darkPositionY: dark.desktop.crop.positionY,
    darkScale: dark.desktop.crop.scale,
    darkOverlayOpacity: dark.desktop.crop.overlayOpacity,
  };
};

export const getSiteSettings = async (db: D1Database) => {
  const row = await db
    .prepare(
      `SELECT * FROM site_settings
       WHERE id = 'default'
       LIMIT 1`,
    )
    .first<Record<string, unknown>>();

  if (!row) {
    throw new Error('站点外观配置不存在');
  }

  return normalizeSiteSettings(row);
};

export const updateSiteSettings = async (db: D1Database, draft: SiteSettingsDraft) => {
  const normalized = normalizeSiteSettingsDraft(draft);
  const timestamp = now();

  await db
    .prepare(
      `UPDATE site_settings
       SET light_background_url = ?,
           light_position_x = ?,
           light_position_y = ?,
           light_scale = ?,
           light_overlay_opacity = ?,
           dark_background_url = ?,
           dark_position_x = ?,
           dark_position_y = ?,
           dark_scale = ?,
           dark_overlay_opacity = ?,
           updated_at = ?
       WHERE id = 'default'`,
    )
    .bind(
      normalized.lightBackgroundUrl,
      normalized.lightPositionX,
      normalized.lightPositionY,
      normalized.lightScale,
      normalized.lightOverlayOpacity,
      normalized.darkBackgroundUrl,
      normalized.darkPositionX,
      normalized.darkPositionY,
      normalized.darkScale,
      normalized.darkOverlayOpacity,
      timestamp,
    )
    .run();

  return getSiteSettings(db);
};
