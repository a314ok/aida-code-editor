import { getElectronBridge } from './bridge';

type OpenDialogOptions = {
  directory?: boolean;
  multiple?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

export const open = (options?: OpenDialogOptions) => {
  return getElectronBridge().openDialog<string | string[] | null>(options);
};
