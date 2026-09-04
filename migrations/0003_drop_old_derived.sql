/* 增量迁移:清理旧「衍生」数据。
 *
 * 应用场景:1.7 主题上线前需要把已有的 submission_type='derived' 数据
 * 处理掉,新版本不再维护这条路径(替代为独立的 continuations 表)。
 *
 * 处理策略:直接删除。
 *
 * 为什么直接删:
 * - 旧衍生只是「同一系列下的另一版 plays」,内容/作者/简介都冗余在
 *   plays 表里,与新方案的「续写是独立表」不兼容;
 * - 这些行的原作者如果想续写,会重新在新版本里写一条 continuations;
 * - 旧 play 的 content 不再被任何广场卡片引用,删除后不会破坏体验。
 *
 * 关联清理:
 * - plays.parent_play_id 指向被删衍生行的 modify 投稿会变成野指针,
 *   这里一并把这些 modify 改成「待修复」状态(改 title 前缀),
 *   让管理员能在审核后台看到并人工处理。
 *   也可以选择直接删 modify 行;这里采用保守做法:清空 parent_play_id,
 *   让审核员通过改 title/分类走「首次投稿」流程。
 *
 * 运行方式(D1 控制台 / wrangler d1 execute):
 *   wrangler d1 execute mini-theater --file migrations/0003_drop_old_derived.sql
 *
 * 建议运行时机:在 migrations/0002_continuations.sql 之后、新版本上线
 * 之后立刻执行(此时旧衍生已不在前端展示,可以安心删)。
 */
DELETE FROM plays WHERE submission_type = 'derived';

/* 清掉指向被删衍生行的 modify 投稿的 parent_play_id,
 * 避免野指针导致审核后台展示异常。 */
UPDATE plays
   SET parent_play_id = NULL
 WHERE submission_type = 'modify'
   AND parent_play_id IS NOT NULL
   AND parent_play_id NOT IN (SELECT id FROM plays);

/* play_parent_requests 里指向被删衍生行的申请也清掉。 */
DELETE FROM play_parent_requests
 WHERE play_id NOT IN (SELECT id FROM plays);