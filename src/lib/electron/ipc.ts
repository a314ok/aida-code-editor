import { getElectronBridge } from './bridge';

export const invoke = <T = unknown>(command: string, args?: Record<string, unknown>) => {
  return getElectronBridge().invoke<T>(command, args);
};
