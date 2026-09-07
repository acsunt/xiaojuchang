import {
  getAdminSessionFromRequest,
  restoreBackupContinuations,
  restoreBackupPlays,
  restoreBackupRepos,
  restoreBackupTags,
} from '../../_lib/db';
import { error, json } from '../../_lib/http';

type BackupPayload = {
  plays?: unknown;
  repos?: unknown;
  continuations?: unknown;
  tags?: unknown;
};

/* 后台「备份恢复」endpoint — 整体覆盖 4 表 (plays / repos / continuations / tags)。
 *
 * 设计:
 * - 接收 4 个 payload 数组,允许任一为 undefined(=不动该表)。
 * - 顺序:plays → repos → continuations → tags。
 *   - 先写 plays 因为其他表都靠 play_id 做 FK;
 *   - 清审计日志紧随其后(避免孤儿审核记录指向旧 id)。
 * - 不做事务:任一阶段失败直接 500,已写入的数据保留(便于诊断 + 运维介入)。
 * - 重复 id 在 helper 内部抛错,统一在这里 catch。
 * - 后端导入用,与前端 mockDb.restoreAdminBackup 行为一致。
 */
export const onRequestPost: PagesFunction = async ({ env, request }) => {
  try {
    const session = await getAdminSessionFromRequest(env.DB, request);
    if (!session) {
      return error('管理员未登录', 401);
    }

    const body = (await request.json()) as BackupPayload;
    const plays = Array.isArray(body.plays) ? body.plays : undefined;
    const repos = Array.isArray(body.repos) ? body.repos : undefined;
    const continuations = Array.isArray(body.continuations) ? body.continuations : undefined;
    const tags = Array.isArray(body.tags) ? body.tags : undefined;

    if (!plays && !repos && !continuations && !tags) {
      return error('备份数据格式无效');
    }

    let playsCount = 0;
    let reposCount = 0;
    let continuationsCount = 0;
    let tagsCount = 0;

    if (plays) {
      const result = await restoreBackupPlays(
        env.DB,
        plays as Parameters<typeof restoreBackupPlays>[1],
      );
      playsCount = result.restoredCount;
    }

    if (repos) {
      const result = await restoreBackupRepos(
        env.DB,
        repos as Parameters<typeof restoreBackupRepos>[1],
      );
      reposCount = result.restoredCount;
    }

    if (continuations) {
      const result = await restoreBackupContinuations(
        env.DB,
        continuations as Parameters<typeof restoreBackupContinuations>[1],
      );
      continuationsCount = result.restoredCount;
    }

    if (tags) {
      const result = await restoreBackupTags(
        env.DB,
        tags as Parameters<typeof restoreBackupTags>[1],
      );
      tagsCount = result.restoredCount;
    }

    return json({
      restoredCount: playsCount + reposCount + continuationsCount + tagsCount,
      restoredByTable: {
        plays: playsCount,
        repos: reposCount,
        continuations: continuationsCount,
        tags: tagsCount,
      },
    });
  } catch (reason) {
    return error(reason instanceof Error ? reason.message : '恢复备份失败', 500);
  }
};
