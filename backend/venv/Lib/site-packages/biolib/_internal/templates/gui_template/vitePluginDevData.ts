import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

export function devDataPlugin(): Plugin {
  let isDev = false;
  
  return {
    name: 'dev-data-plugin',
    configResolved(config) {
      isDev = config.mode === 'development';
    },
    transform(code: string, id: string) {
      if (id.endsWith('biolibSdk.ts')) {
        let injectedCode: string;
        
        if (isDev) {
          const devDataDir = path.join(__dirname, 'devData');
          const devDataMap: Record<string, string> = {};
          
          if (fs.existsSync(devDataDir)) {
            const entries = fs.readdirSync(devDataDir, { recursive: true });
            for (const entry of entries) {
              const relativePath = entry.toString();
              const fullPath = path.join(devDataDir, relativePath);
              if (fs.statSync(fullPath).isFile()) {
                const content = fs.readFileSync(fullPath);
                const base64Content = content.toString('base64');
                devDataMap[relativePath] = base64Content;
              }
            }
          }
          
          const devDataJson = JSON.stringify(devDataMap);
          injectedCode = code.replace(
            "const DEV_DATA_FILES = {};",
            `const DEV_DATA_FILES = ${devDataJson};`
          );
        } else {
          injectedCode = code;
        }
        
        return {
          code: injectedCode,
          map: null
        };
      }
    }
  };
}
