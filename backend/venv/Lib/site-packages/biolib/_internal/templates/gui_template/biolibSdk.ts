interface IGetFileFromDataRecordOptions {
  uri: string;
  path: string;
}

interface IRunJobPayload {
  appUri: string;
  arguments: string[];
  files: Record<string, { data: Uint8Array }>;
  temporaryClientSecrets?: Record<string, string>;
  openResult?: boolean | 'currentWindow' | 'newTab';
  blocking?: boolean;
}

interface IJobProgress {
  logMessage?: string;
  systemLogMessage?: string;
  jobId: string;
}

interface IJobResult {
  exit_code: number;
  stderr: Uint8Array;
  stdout: Uint8Array;
  files: Record<string, { data: Uint8Array }>;
  jobId: string;
}

interface IPendingJobResult {
  jobId: string;
  authToken: string;
}

interface IBioLibGlobals {
  getFileDataFromDataRecord: (options: IGetFileFromDataRecordOptions) => Promise<Uint8Array>;
  getOutputFileData: (path: string) => Promise<Uint8Array>;
  listOutputFilePaths: () => Promise<string[]>;
  runJob: (payload: IRunJobPayload, jobProgressHandler?: (jobProgress: IJobProgress) => void) => Promise<IJobResult | IPendingJobResult>;
}

declare global {
  const biolib: IBioLibGlobals;
}

// DO NOT MODIFY: Development data files are injected at build time from gui/devData/ folder
const DEV_DATA_FILES: Record<string, string> = {};

const devSdkBioLib: IBioLibGlobals = {
  getFileDataFromDataRecord: async (_options: IGetFileFromDataRecordOptions): Promise<Uint8Array> => {
    throw new Error('getFileDataFromDataRecord is not available in local development mode.');
  },
  getOutputFileData: async (path: string): Promise<Uint8Array> => {
    console.log(`[SDK] getOutputFileData called with path: ${path}`);
    
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    
    if (typeof DEV_DATA_FILES !== 'undefined' && normalizedPath in DEV_DATA_FILES) {
      const base64Data = DEV_DATA_FILES[normalizedPath];
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    
    throw new Error(`File not found: ${path}. Add this file to the devData/ folder for local development.`);
  },
  listOutputFilePaths: async (): Promise<string[]> => {
    throw new Error('listOutputFilePaths is not available in local development mode.');
  },
  runJob: async (_payload: IRunJobPayload, _jobProgressHandler?: (jobProgress: IJobProgress) => void): Promise<IJobResult | IPendingJobResult> => {
    throw new Error('runJob is not available in local development mode.');
  },
};

const biolib: IBioLibGlobals =
  process.env.NODE_ENV === "development"
    ? devSdkBioLib
    : (window as any).biolib;

export default biolib;
