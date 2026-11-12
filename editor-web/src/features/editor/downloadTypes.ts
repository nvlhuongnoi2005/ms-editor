export interface DownloadFile {
  id: string;
  dataset: string;
  filename: string;
  total: number;
  sha256: string;
}
export interface DownloadState {
  mode: 'initializing' | 'idle' | 'paused' | 'downloading' | 'verifying' | 'ready' | 'saving' | 'saved' | 'stopping';
  file: DownloadFile | null;
  offset: number;
  error: string | null;
  checked?: number;
  verificationFailed?: boolean;
}
export interface DownloadRequest {
  seq: number;
  action: 'init' | 'start' | 'resume' | 'pause' | 'stop' | 'file';
  directory?: string;
  file?: DownloadFile;
}
export interface DownloadReply { seq?: number; state: DownloadState; file?: File; failed?: boolean }
