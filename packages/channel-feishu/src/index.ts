import { createLarkApi, createLarkEvents, type FeishuCredentials } from "./api.js";
import { FeishuChannel } from "./channel.js";

export { FeishuChannel, type FeishuChannelOptions } from "./channel.js";
export { createLarkApi, createLarkEvents, type FeishuApi, type FeishuCredentials, type FeishuEvents } from "./api.js";
export { FEISHU_CHANNEL_ID } from "./inbound.js";
export { feishuProvider, type FeishuSetupApi } from "./provider.js";

/** A Feishu channel over the official SDK's long connection and Open API client. */
export function createFeishuChannel(credentials: FeishuCredentials, options: { readonly onError?: (error: unknown) => void } = {}): FeishuChannel {
  return new FeishuChannel({ api: createLarkApi(credentials), events: createLarkEvents(credentials), ...options });
}
