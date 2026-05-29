export interface CloudFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: Date;
}

export interface CloudQuota {
  usedBytes: number;
  totalBytes: number;
}

export interface CloudUploadResult {
  fileId: string;
  name: string;
  size: number;
  webViewLink?: string;
}

export interface ICloudClient {
  verify(): Promise<{ ok: boolean; error?: string; quota?: CloudQuota }>;
  createFolder(name: string, parentId?: string): Promise<string>;
  uploadFile(
    name: string,
    data: Buffer | NodeJS.ReadableStream,
    folderId: string,
    mimeType?: string,
  ): Promise<CloudUploadResult>;
  deleteFile(fileId: string): Promise<void>;
  listFiles(folderId: string): Promise<CloudFile[]>;
  downloadFile(fileId: string): Promise<Buffer>;
  getQuota(): Promise<CloudQuota>;
}
