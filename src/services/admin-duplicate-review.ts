import type { Play } from '../types/play';

const DUPLICATE_REVIEW_STORAGE_KEY = 'mini-theater:admin-duplicate-review';
const DEFAULT_THRESHOLD = 85;
const SCAN_YIELD_INTERVAL = 120;

type DiffToken = {
  value: string;
  changed: boolean;
};

export type DuplicateScanScope = 'all' | 'approved';

export type DuplicatePlaySnapshot = Pick<
  Play,
  | 'id'
  | 'title'
  | 'authorName'
  | 'category'
  | 'summary'
  | 'content'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
>;

export type DuplicateMatch = {
  play: DuplicatePlaySnapshot;
  similarity: number;
};

export type DuplicateGroup = {
  id: string;
  anchor: DuplicatePlaySnapshot;
  duplicates: DuplicateMatch[];
};

export type DuplicateReviewState = {
  threshold: number;
  scanScope: DuplicateScanScope;
  groups: DuplicateGroup[];
  selectedIds: string[];
  activeGroupId: string;
  activeComparedPlayId: string;
  scannedAt: string;
  scannedCount: number;
};

export type DuplicateScanProgress = {
  completedAnchors: number;
  totalAnchors: number;
  processedPairs: number;
  totalPairs: number;
};

type DuplicateScanOptions = {
  onProgress?: (progress: DuplicateScanProgress) => void;
  scanScope?: DuplicateScanScope;
  shouldStop?: () => boolean;
};

type PreparedPlay = {
  play: Play;
  snapshot: DuplicatePlaySnapshot;
  normalizedText: string;
};

const createEmptyState = (
  threshold = DEFAULT_THRESHOLD,
  scanScope: DuplicateScanScope = 'all',
): DuplicateReviewState => ({
  threshold,
  scanScope,
  groups: [],
  selectedIds: [],
  activeGroupId: '',
  activeComparedPlayId: '',
  scannedAt: '',
  scannedCount: 0,
});

const readStore = (): DuplicateReviewState => {
  if (typeof window === 'undefined') {
    return createEmptyState();
  }

  const raw = window.localStorage.getItem(DUPLICATE_REVIEW_STORAGE_KEY);
  if (!raw) {
    return createEmptyState();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DuplicateReviewState>;
    return {
      threshold:
        typeof parsed.threshold === 'number' && parsed.threshold >= 70 && parsed.threshold <= 100
          ? Math.round(parsed.threshold)
          : DEFAULT_THRESHOLD,
      scanScope: parsed.scanScope === 'approved' ? 'approved' : 'all',
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds : [],
      activeGroupId: typeof parsed.activeGroupId === 'string' ? parsed.activeGroupId : '',
      activeComparedPlayId:
        typeof parsed.activeComparedPlayId === 'string' ? parsed.activeComparedPlayId : '',
      scannedAt: typeof parsed.scannedAt === 'string' ? parsed.scannedAt : '',
      scannedCount: typeof parsed.scannedCount === 'number' ? parsed.scannedCount : 0,
    };
  } catch {
    return createEmptyState();
  }
};

export const getDuplicateReviewState = () => readStore();

export const saveDuplicateReviewState = (state: DuplicateReviewState) => {
  if (typeof window === 'undefined') {
    return state;
  }

  window.localStorage.setItem(DUPLICATE_REVIEW_STORAGE_KEY, JSON.stringify(state));
  return state;
};

export const clearDuplicateReviewState = (
  currentState?: Pick<DuplicateReviewState, 'threshold' | 'scanScope'>,
) =>
  saveDuplicateReviewState(
    createEmptyState(
      currentState?.threshold ?? DEFAULT_THRESHOLD,
      currentState?.scanScope ?? 'all',
    ),
  );

export const setDuplicateThreshold = (threshold: number) => {
  const currentState = readStore();
  return saveDuplicateReviewState({
    ...currentState,
    threshold: Math.min(100, Math.max(70, Math.round(threshold))),
  });
};

export const setDuplicateScanScope = (scanScope: DuplicateScanScope) => {
  const currentState = readStore();
  return saveDuplicateReviewState({
    ...currentState,
    scanScope,
    groups: [],
    selectedIds: [],
    activeGroupId: '',
    activeComparedPlayId: '',
    scannedAt: '',
    scannedCount: 0,
  });
};

const toSnapshot = (play: Play): DuplicatePlaySnapshot => ({
  id: play.id,
  title: play.title,
  authorName: play.authorName,
  category: play.category,
  summary: play.summary,
  content: play.content,
  status: play.status,
  createdAt: play.createdAt,
  updatedAt: play.updatedAt,
});

const getScopedPlays = (plays: Play[], scanScope: DuplicateScanScope) =>
  scanScope === 'approved' ? plays.filter((play) => play.status === 'approved') : plays;

const sortByCreatedAt = (items: Play[]) =>
  [...items].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.updatedAt.localeCompare(right.updatedAt) ||
      left.id.localeCompare(right.id),
  );

const normalizeTextForSimilarity = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\buser\b/gi, 'role')
    .replace(/\bchar\b/gi, 'role')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const toSimilarityTokens = (value: string) => Array.from(value.replace(/\s/g, ''));

const preparePlay = (play: Play): PreparedPlay => ({
  play,
  snapshot: toSnapshot(play),
  normalizedText: normalizeTextForSimilarity(play.content),
});

const getSimilarity = (left: PreparedPlay, right: PreparedPlay) => {
  if (!left.normalizedText || !right.normalizedText) {
    return 0;
  }

  if (left.normalizedText === right.normalizedText) {
    return 100;
  }

  const leftTokens = toSimilarityTokens(left.normalizedText);
  const rightTokens = toSimilarityTokens(right.normalizedText);
  const matrix = buildLcsMatrix(leftTokens, rightTokens);
  const commonLength = matrix[0]?.[0] ?? 0;
  const longerLength = Math.max(leftTokens.length, rightTokens.length);

  return longerLength === 0 ? 0 : Math.round((commonLength / longerLength) * 100);
};

const createProgressState = (
  totalAnchors: number,
  completedAnchors: number,
  processedPairs: number,
  totalPairs: number,
): DuplicateScanProgress => ({
  completedAnchors,
  totalAnchors,
  processedPairs,
  totalPairs,
});

const notifyProgress = (
  totalAnchors: number,
  completedAnchors: number,
  processedPairs: number,
  totalPairs: number,
  onProgress?: (progress: DuplicateScanProgress) => void,
) => {
  onProgress?.(createProgressState(totalAnchors, completedAnchors, processedPairs, totalPairs));
};

const yieldToMainThread = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export const scanDuplicateGroups = async (
  plays: Play[],
  threshold: number,
  options: DuplicateScanOptions = {},
) => {
  const scanScope = options.scanScope ?? 'all';
  const sortedPlays = sortByCreatedAt(getScopedPlays(plays, scanScope));
  const preparedPlays = sortedPlays.map(preparePlay);
  const consumed = new Set<string>();
  const groups: DuplicateGroup[] = [];
  const totalAnchors = preparedPlays.length;
  const totalPairs = totalAnchors <= 1 ? 0 : Math.floor((totalAnchors * (totalAnchors - 1)) / 2);
  let processedPairs = 0;
  let completedAnchors = 0;

  notifyProgress(totalAnchors, completedAnchors, processedPairs, totalPairs, options.onProgress);

  for (let anchorIndex = 0; anchorIndex < preparedPlays.length; anchorIndex += 1) {
    if (options.shouldStop?.()) {
      throw new Error('重复扫描已取消');
    }

    const anchorPlay = preparedPlays[anchorIndex];
    if (consumed.has(anchorPlay.play.id)) {
      completedAnchors = anchorIndex + 1;
      notifyProgress(
        totalAnchors,
        completedAnchors,
        processedPairs,
        totalPairs,
        options.onProgress,
      );
      continue;
    }

    const duplicates: DuplicateMatch[] = [];

    for (let index = anchorIndex + 1; index < preparedPlays.length; index += 1) {
      if (options.shouldStop?.()) {
        throw new Error('重复扫描已取消');
      }

      const targetPlay = preparedPlays[index];
      processedPairs += 1;

      if (!consumed.has(targetPlay.play.id)) {
        const similarity = getSimilarity(anchorPlay, targetPlay);
        if (similarity >= threshold) {
          duplicates.push({
            play: targetPlay.snapshot,
            similarity,
          });
          consumed.add(targetPlay.play.id);
        }
      }

      if (processedPairs % SCAN_YIELD_INTERVAL === 0) {
        notifyProgress(
          totalAnchors,
          completedAnchors,
          processedPairs,
          totalPairs,
          options.onProgress,
        );
        await yieldToMainThread();
      }
    }

    if (duplicates.length > 0) {
      groups.push({
        id: anchorPlay.play.id,
        anchor: anchorPlay.snapshot,
        duplicates: duplicates.sort(
          (left, right) =>
            right.similarity - left.similarity ||
            left.play.createdAt.localeCompare(right.play.createdAt),
        ),
      });
    }

    completedAnchors = anchorIndex + 1;
    notifyProgress(totalAnchors, completedAnchors, processedPairs, totalPairs, options.onProgress);
    await yieldToMainThread();
  }

  const nextState: DuplicateReviewState = {
    threshold,
    scanScope,
    groups,
    selectedIds: [],
    activeGroupId: groups[0]?.id ?? '',
    activeComparedPlayId: groups[0]?.duplicates[0]?.play.id ?? '',
    scannedAt: new Date().toISOString(),
    scannedCount: sortedPlays.length,
  };

  notifyProgress(totalAnchors, totalAnchors, totalPairs, totalPairs, options.onProgress);
  return saveDuplicateReviewState(nextState);
};

export const pruneDuplicateReviewState = (state: DuplicateReviewState, plays: Play[]) => {
  const scopedPlays = getScopedPlays(plays, state.scanScope);
  const validIds = new Set(scopedPlays.map((play) => play.id));
  const nextGroups = state.groups
    .map((group) => ({
      ...group,
      duplicates: group.duplicates.filter((item) => validIds.has(item.play.id)),
    }))
    .filter((group) => validIds.has(group.anchor.id) && group.duplicates.length > 0);

  const nextState: DuplicateReviewState = {
    ...state,
    groups: nextGroups,
    selectedIds: state.selectedIds.filter((id) => validIds.has(id)),
    activeGroupId: nextGroups.some((group) => group.id === state.activeGroupId)
      ? state.activeGroupId
      : (nextGroups[0]?.id ?? ''),
    activeComparedPlayId: nextGroups.some((group) =>
      group.duplicates.some((item) => item.play.id === state.activeComparedPlayId),
    )
      ? state.activeComparedPlayId
      : (nextGroups[0]?.duplicates[0]?.play.id ?? ''),
    scannedCount: scopedPlays.length,
  };

  return saveDuplicateReviewState(nextState);
};

export const toggleDuplicateSelection = (state: DuplicateReviewState, playId: string) => {
  const nextSelectedIds = state.selectedIds.includes(playId)
    ? state.selectedIds.filter((id) => id !== playId)
    : [...state.selectedIds, playId];

  return saveDuplicateReviewState({
    ...state,
    selectedIds: nextSelectedIds,
  });
};

export const setDuplicateCompareTarget = (
  state: DuplicateReviewState,
  groupId: string,
  playId: string,
) =>
  saveDuplicateReviewState({
    ...state,
    activeGroupId: groupId,
    activeComparedPlayId: playId,
  });

export const collectAllDuplicateIds = (groups: DuplicateGroup[]) =>
  groups.flatMap((group) => group.duplicates.map((item) => item.play.id));

export const collectSecondDuplicateIds = (groups: DuplicateGroup[]) =>
  groups.map((group) => group.duplicates[0]?.play.id).filter(Boolean) as string[];

const tokenizeWords = (value: string) => value.match(/\S+\s*/g) ?? [];

const buildLcsMatrix = (left: string[], right: string[]) => {
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array.from<number>({ length: right.length + 1 }).fill(0),
  );

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      matrix[leftIndex][rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? matrix[leftIndex + 1][rightIndex + 1] + 1
          : Math.max(matrix[leftIndex + 1][rightIndex], matrix[leftIndex][rightIndex + 1]);
    }
  }

  return matrix;
};

const pushToken = (target: DiffToken[], value: string, changed: boolean) => {
  const lastItem = target[target.length - 1];
  if (lastItem && lastItem.changed === changed) {
    lastItem.value += value;
    return;
  }

  target.push({ value, changed });
};

export const buildSideBySideDiff = (left: string, right: string) => {
  const leftTokens = tokenizeWords(left);
  const rightTokens = tokenizeWords(right);
  const matrix = buildLcsMatrix(leftTokens, rightTokens);

  const leftSegments: DiffToken[] = [];
  const rightSegments: DiffToken[] = [];

  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftTokens.length && rightIndex < rightTokens.length) {
    if (leftTokens[leftIndex] === rightTokens[rightIndex]) {
      pushToken(leftSegments, leftTokens[leftIndex], false);
      pushToken(rightSegments, rightTokens[rightIndex], false);
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (matrix[leftIndex + 1][rightIndex] >= matrix[leftIndex][rightIndex + 1]) {
      pushToken(leftSegments, leftTokens[leftIndex], true);
      leftIndex += 1;
      continue;
    }

    pushToken(rightSegments, rightTokens[rightIndex], true);
    rightIndex += 1;
  }

  while (leftIndex < leftTokens.length) {
    pushToken(leftSegments, leftTokens[leftIndex], true);
    leftIndex += 1;
  }

  while (rightIndex < rightTokens.length) {
    pushToken(rightSegments, rightTokens[rightIndex], true);
    rightIndex += 1;
  }

  return {
    leftSegments,
    rightSegments,
  };
};
