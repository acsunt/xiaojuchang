// 数据库层公用的小工具：数值裁剪、数组分片，以及 D1 批量操作的分片大小常量。
// 被 plays.ts / repos.ts / tags.ts 共用，避免拆分后每个文件各自重复实现。

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const chunkItems = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

// D1 单次 batch/IN 查询允许绑定的参数上限，超过会报错，所有批量读写都要按此分片。
const D1_MAX_BATCH_VARIABLES = 90;

export const D1_SELECT_CHUNK_SIZE = D1_MAX_BATCH_VARIABLES;
export const D1_TAG_REORDER_CHUNK_SIZE = Math.max(1, Math.floor(D1_MAX_BATCH_VARIABLES / 3));
export const D1_BULK_REVIEW_PLAY_CHUNK_SIZE = Math.max(1, Math.floor(D1_MAX_BATCH_VARIABLES / 11));
export const D1_BACKUP_INSERT_CHUNK_SIZE = Math.max(1, Math.floor(D1_MAX_BATCH_VARIABLES / 11));
