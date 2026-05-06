export const isDebugEnabled = (): boolean => {
  return process.env.SZUM_DEBUG === "true";
};

export const debug = (msg: string): void => {
  console.error(`[szum-sdk] ${msg}`);
};
