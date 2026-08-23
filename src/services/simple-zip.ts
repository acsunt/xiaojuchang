const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_UTF8_FLAG = 0x0800;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const crc32Table = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

const getCrc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const concatUint8Arrays = (parts: Uint8Array[]) => {
  const totalLength = parts.reduce((sum, item) => sum + item.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;

  for (const item of parts) {
    buffer.set(item, offset);
    offset += item.length;
  }

  return buffer;
};

const createBuffer = (size: number) => new Uint8Array(size);

const setUint16 = (view: DataView, offset: number, value: number) => {
  view.setUint16(offset, value, true);
};

const setUint32 = (view: DataView, offset: number, value: number) => {
  view.setUint32(offset, value >>> 0, true);
};

const getUint16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const getUint32 = (view: DataView, offset: number) => view.getUint32(offset, true);

export type ZipTextFile = {
  name: string;
  text: string;
};

export const createZipFromTextFiles = (files: ZipTextFile[]) => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = textEncoder.encode(file.name);
    const dataBytes = textEncoder.encode(file.text);
    const crc32 = getCrc32(dataBytes);

    const localHeader = createBuffer(30 + nameBytes.length);
    const localHeaderView = new DataView(localHeader.buffer);
    setUint32(localHeaderView, 0, LOCAL_FILE_SIGNATURE);
    setUint16(localHeaderView, 4, ZIP_VERSION);
    setUint16(localHeaderView, 6, ZIP_UTF8_FLAG);
    setUint16(localHeaderView, 8, 0);
    setUint16(localHeaderView, 10, 0);
    setUint16(localHeaderView, 12, 0);
    setUint32(localHeaderView, 14, crc32);
    setUint32(localHeaderView, 18, dataBytes.length);
    setUint32(localHeaderView, 22, dataBytes.length);
    setUint16(localHeaderView, 26, nameBytes.length);
    setUint16(localHeaderView, 28, 0);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = createBuffer(46 + nameBytes.length);
    const centralHeaderView = new DataView(centralHeader.buffer);
    setUint32(centralHeaderView, 0, CENTRAL_DIRECTORY_SIGNATURE);
    setUint16(centralHeaderView, 4, ZIP_VERSION);
    setUint16(centralHeaderView, 6, ZIP_VERSION);
    setUint16(centralHeaderView, 8, ZIP_UTF8_FLAG);
    setUint16(centralHeaderView, 10, 0);
    setUint16(centralHeaderView, 12, 0);
    setUint16(centralHeaderView, 14, 0);
    setUint32(centralHeaderView, 16, crc32);
    setUint32(centralHeaderView, 20, dataBytes.length);
    setUint32(centralHeaderView, 24, dataBytes.length);
    setUint16(centralHeaderView, 28, nameBytes.length);
    setUint16(centralHeaderView, 30, 0);
    setUint16(centralHeaderView, 32, 0);
    setUint16(centralHeaderView, 34, 0);
    setUint16(centralHeaderView, 36, 0);
    setUint32(centralHeaderView, 38, 0);
    setUint32(centralHeaderView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + dataBytes.length;
  }

  const localBytes = concatUint8Arrays(localParts);
  const centralBytes = concatUint8Arrays(centralParts);
  const endRecord = createBuffer(22);
  const endRecordView = new DataView(endRecord.buffer);
  setUint32(endRecordView, 0, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  setUint16(endRecordView, 4, 0);
  setUint16(endRecordView, 6, 0);
  setUint16(endRecordView, 8, files.length);
  setUint16(endRecordView, 10, files.length);
  setUint32(endRecordView, 12, centralBytes.length);
  setUint32(endRecordView, 16, localBytes.length);
  setUint16(endRecordView, 20, 0);

  return new Blob([localBytes, centralBytes, endRecord], { type: 'application/zip' });
};

const findEndOfCentralDirectoryOffset = (bytes: Uint8Array) => {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    const value = bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24);

    if ((value >>> 0) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return -1;
};

export const readZipTextFiles = async (blob: Blob): Promise<ZipTextFile[]> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectoryOffset(bytes);

  if (endOffset < 0) {
    throw new Error('备份压缩包格式无效');
  }

  const totalEntries = getUint16(view, endOffset + 10);
  const centralDirectoryOffset = getUint32(view, endOffset + 16);
  const files: ZipTextFile[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (getUint32(view, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('备份压缩包目录损坏');
    }

    const flags = getUint16(view, offset + 8);
    const compression = getUint16(view, offset + 10);
    const crc32 = getUint32(view, offset + 16);
    const compressedSize = getUint32(view, offset + 20);
    const nameLength = getUint16(view, offset + 28);
    const extraLength = getUint16(view, offset + 30);
    const commentLength = getUint16(view, offset + 32);
    const localHeaderOffset = getUint32(view, offset + 42);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
    const name = textDecoder.decode(nameBytes);

    if (compression !== 0) {
      throw new Error(`备份压缩包里的 ${name} 使用了当前不支持的压缩方式`);
    }

    if (getUint32(view, localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`备份压缩包里的 ${name} 本地头损坏`);
    }

    const localNameLength = getUint16(view, localHeaderOffset + 26);
    const localExtraLength = getUint16(view, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataBytes = bytes.slice(dataOffset, dataOffset + compressedSize);

    if (getCrc32(dataBytes) !== crc32) {
      throw new Error(`备份压缩包里的 ${name} 校验失败`);
    }

    const text = textDecoder.decode(dataBytes);
    files.push({ name, text });

    offset += 46 + nameLength + extraLength + commentLength;

    if ((flags & ZIP_UTF8_FLAG) === 0) {
      throw new Error(`备份压缩包里的 ${name} 不是 UTF-8 文件名`);
    }
  }

  return files;
};