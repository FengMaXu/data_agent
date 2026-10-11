import * as Lark from "@larksuiteoapi/node-sdk";
import type { ChannelConfig, ChannelProvider, ChannelProvisioning } from "@data-agent/contracts";
import { createLarkApi, createLarkEvents, type FeishuCredentials } from "./api.js";
import { FeishuChannel } from "./channel.js";
import { FEISHU_CHANNEL_ID } from "./inbound.js";

const LARK_OPEN_DOMAIN = "https://open.larksuite.com";

/** What the bot needs: read what people send it, answer as itself, send pictures and files, and set itself up. */
const SCOPES = [
  "im:message",
  "im:message:send_as_bot",
  "im:message.p2p_msg:readonly",
  "im:message.group_at_msg:readonly",
  "im:resource",
  "application:application:patch",
];
const EVENTS = ["im.message.receive_v1"];
const CALLBACKS = ["card.action.trigger"];

/** The platform calls behind scan-to-connect; replaced in tests. */
export interface FeishuSetupApi {
  registerApp: typeof Lark.registerApp;
  /** Switches events and callbacks to the long connection and publishes the change. */
  useLongConnection(credentials: FeishuCredentials): Promise<void>;
}

function credentials(config: ChannelConfig): FeishuCredentials {
  const { appId, appSecret, domain } = config;
  if (typeof appId !== "string" || !appId || typeof appSecret !== "string" || !appSecret) throw new Error("FEISHU_CONFIG_INVALID");
  return { appId, appSecret, ...(typeof domain === "string" && domain ? { domain } : {}) };
}

function checked(response: { code?: number; msg?: string } | null | undefined, operation: string): void {
  if (response?.code !== undefined && response.code !== 0) throw new Error(`FEISHU_${operation}_FAILED: ${response.code} ${response.msg ?? ""}`.trim());
}

const larkSetup: FeishuSetupApi = {
  registerApp: Lark.registerApp,
  async useLongConnection(app) {
    const client = new Lark.Client({ appId: app.appId, appSecret: app.appSecret, ...(app.domain ? { domain: app.domain } : {}) });
    checked(await client.application.v7.applicationConfig.patch({
      path: { app_id: app.appId },
      data: {
        event: { subscription_type: "websocket", add_events: EVENTS },
        callback: { callback_type: "websocket", add_callbacks: CALLBACKS },
      },
    }), "CONFIG");
    checked(await client.application.v7.applicationPublish.create({
      path: { app_id: app.appId },
      data: { remark: "数据智能体接入", changelog: "使用长连接接收消息与卡片回调" },
    }), "PUBLISH");
  },
};

/**
 * Feishu for the channel registry. Scan-to-connect creates the bot through
 * Feishu's device flow with the permissions, events and callback it needs.
 * Feishu does not let that flow choose the long connection, so it is set
 * afterwards; when Feishu refuses, the user gets the one step left to do.
 */
export function feishuProvider(options: { readonly onError?: (error: unknown) => void; readonly setup?: FeishuSetupApi } = {}): ChannelProvider {
  const setup = options.setup ?? larkSetup;
  return {
    id: FEISHU_CHANNEL_ID,
    label: "飞书",
    create(config) {
      const app = credentials(config);
      return new FeishuChannel({ api: createLarkApi(app), events: createLarkEvents(app), ...(options.onError ? { onError: options.onError } : {}) });
    },
    provision(signal): ChannelProvisioning {
      let announce!: (link: { url: string; expiresAt: number }) => void;
      const ready = new Promise<{ url: string; expiresAt: number }>((resolve) => { announce = resolve; });
      const done = (async () => {
        const result = await setup.registerApp({
          signal,
          source: "data-agent",
          createOnly: true,
          appPreset: { name: "{user}的数据助手", desc: "在飞书里查询数据、生成看板" },
          addons: { scopes: { tenant: SCOPES }, events: { items: { tenant: EVENTS } }, callbacks: { items: CALLBACKS } },
          onQRCodeReady: (info) => announce({ url: info.url, expiresAt: Date.now() + info.expireIn * 1000 }),
        });
        const app: FeishuCredentials = { appId: result.client_id, appSecret: result.client_secret, ...(result.user_info?.tenant_brand === "lark" ? { domain: LARK_OPEN_DOMAIN } : {}) };
        const warnings: string[] = [];
        try {
          await setup.useLongConnection(app);
        } catch (error) {
          options.onError?.(error);
          const console = app.domain === LARK_OPEN_DOMAIN ? "https://open.larksuite.com/app" : "https://open.feishu.cn/app";
          warnings.push(`飞书没有允许自动设置长连接。请打开 ${console}/${app.appId}/event ，把“事件配置”和“回调配置”的订阅方式都改为“使用长连接接收”，然后发布新版本。`);
        }
        return { config: { ...app } as ChannelConfig, warnings };
      })();
      // A flow that fails before the link exists must not leave `ready` waiting forever.
      return { ready: Promise.race([ready, done.then(() => { throw new Error("FEISHU_PROVISION_NO_LINK"); })]), done };
    },
  };
}
