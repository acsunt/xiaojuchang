import { getSiteSettings } from '../_lib/db';
import { error, json } from '../_lib/http';

export const onRequestGet: PagesFunction = async ({ env }) => {
  try {
    const settings = await getSiteSettings(env.DB);
    return json(settings);
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '站点外观配置加载失败', 500);
  }
};
