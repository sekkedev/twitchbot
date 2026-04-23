export interface IpcOk<T> {
  success: true;
  data: T;
}
export interface IpcErr {
  success: false;
  error: string;
}
export type IpcResult<T> = IpcOk<T> | IpcErr;

export async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const res = (await window.api.invoke(channel, payload)) as IpcResult<T>;
  if (!res.success) throw new Error(res.error);
  return res.data;
}

export async function tryInvoke<T>(
  channel: string,
  payload?: unknown,
): Promise<IpcResult<T>> {
  try {
    const res = (await window.api.invoke(channel, payload)) as IpcResult<T>;
    return res;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function on<T = unknown>(
  channel: string,
  listener: (payload: T) => void,
): () => void {
  return window.api.on(channel, (...args: unknown[]) => listener(args[0] as T));
}
