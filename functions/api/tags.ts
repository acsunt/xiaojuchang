import { listTags } from '../_lib/db';
import { json } from '../_lib/http';

export const onRequestGet: PagesFunction = async ({ env }) => {
  const tags = await listTags(env.DB);
  return json(tags);
};
