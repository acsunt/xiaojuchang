// covers site-settings.ts：getSiteSettings / updateSiteSettings。
import { beforeEach, describe, expect, it } from 'vitest';
import { getSiteSettings, updateSiteSettings } from '../db';
import { createTestD1, SITE_SETTINGS_SCHEMA_SQL } from './test-d1';

const insertDefaultRow = (db: ReturnType<typeof createTestD1>) => {
  db.sqlite
    .prepare(
      `INSERT INTO site_settings (
        id, light_background_url, light_position_x, light_position_y, light_scale, light_overlay_opacity,
        dark_background_url, dark_position_x, dark_position_y, dark_scale, dark_overlay_opacity,
        created_at, updated_at
      ) VALUES ('default', '', 50, 50, 100, 0.2, '', 50, 50, 100, 0.32, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run();
};

const makeDraft = () => ({
  light: {
    desktop: { backgroundUrl: 'https://example.com/light-desktop.jpg', crop: { positionX: 10, positionY: 20, scale: 150, backgroundOpacity: 0.8, overlayOpacity: 0.1 } },
    mobile: { backgroundUrl: 'https://example.com/light-mobile.jpg', crop: { positionX: 30, positionY: 40, scale: 120, backgroundOpacity: 0.9, overlayOpacity: 0.15 } },
  },
  dark: {
    desktop: { backgroundUrl: 'https://example.com/dark-desktop.jpg', crop: { positionX: 50, positionY: 60, scale: 200, backgroundOpacity: 0.7, overlayOpacity: 0.3 } },
    mobile: { backgroundUrl: 'https://example.com/dark-mobile.jpg', crop: { positionX: 70, positionY: 80, scale: 180, backgroundOpacity: 0.6, overlayOpacity: 0.4 } },
  },
});

describe('site-settings 读写函数', () => {
  let db: ReturnType<typeof createTestD1>;

  beforeEach(() => {
    db = createTestD1();
    db.sqlite.exec(SITE_SETTINGS_SCHEMA_SQL);
    insertDefaultRow(db);
  });

  it('getSiteSettings 在没有 default 行时抛错', async () => {
    const emptyDb = createTestD1();
    emptyDb.sqlite.exec(SITE_SETTINGS_SCHEMA_SQL);
    await expect(getSiteSettings(emptyDb)).rejects.toThrow('站点外观配置不存在');
  });

  it('getSiteSettings 读取默认行，桌面/移动端回退到同一份配置', async () => {
    const settings = await getSiteSettings(db);
    expect(settings.light.desktop.backgroundUrl).toBe('');
    expect(settings.light.mobile.backgroundUrl).toBe('');
    expect(settings.light.desktop.crop.positionX).toBe(50);
  });

  it('updateSiteSettings 写入桌面/移动端各自独立的配置，并做数值裁剪', async () => {
    const updated = await updateSiteSettings(db, makeDraft());

    expect(updated.light.desktop.backgroundUrl).toBe('https://example.com/light-desktop.jpg');
    expect(updated.light.mobile.backgroundUrl).toBe('https://example.com/light-mobile.jpg');
    expect(updated.dark.desktop.crop.positionX).toBe(50);
    // scale 被裁剪到 [100, 240] 区间内
    expect(updated.dark.mobile.crop.scale).toBe(180);
  });

  it('updateSiteSettings 对超出范围的数值做裁剪', async () => {
    const draft = makeDraft();
    draft.light.desktop.crop.scale = 1000;
    draft.light.desktop.crop.positionX = -20;
    draft.light.desktop.crop.overlayOpacity = 5;

    const updated = await updateSiteSettings(db, draft);
    expect(updated.light.desktop.crop.scale).toBe(240);
    expect(updated.light.desktop.crop.positionX).toBe(0);
    expect(updated.light.desktop.crop.overlayOpacity).toBe(0.9);
  });
});
