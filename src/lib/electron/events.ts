import { getElectronBridge } from './bridge';

export type UnlistenFn = () => void;
export type IpcEvent<T> = {
  event: string;
  payload: T;
  id: number;
};

export const listen = async <T = unknown>(
  event: string,
  handler: (event: IpcEvent<T>) => void,
): Promise<UnlistenFn> => {
  return getElectronBridge().on<T>(event, payload => {
    handler({ event, payload, id: 0 });
  });
};
