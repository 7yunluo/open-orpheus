import { contextBridge, ipcRenderer } from "electron";
import { IPC, NIM_APP_KEY } from "../shared/listenTogetherConstants";

// ===== Types =====

type ConnectionState = "disconnected" | "connecting" | "connected";
type ChatRoomState = "none" | "entering" | "entered";
type YunxinPayload = Record<string, unknown>;
type Callback = (data: YunxinPayload) => void;

interface NimSignalingChannel {
  channelId?: string;
  channelName?: string;
}

interface NimInstance {
  on(event: string, handler: (...args: unknown[]) => void): void;
  destroy(opts: Record<string, unknown>): void;
  signalingCreateAndJoin(opts: Record<string, unknown>): Promise<NimSignalingChannel>;
  signalingGetChannelInfo(opts: Record<string, unknown>): Promise<NimSignalingChannel | null>;
  signalingJoin(opts: Record<string, unknown>): Promise<NimSignalingChannel>;
}

interface ChatroomInstance {
  connect(): void;
  disconnect(opts: Record<string, unknown>): void;
  sendText(opts: { text: string; done?: (err: unknown) => void }): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

interface NimSDK {
  NIM: {
    getInstance(opts: Record<string, unknown>): NimInstance;
  };
  Chatroom: {
    getInstance(opts: Record<string, unknown>): ChatroomInstance;
  };
}

let SDK: NimSDK | null = null;

// ===== State =====

let nimInstance: NimInstance | null = null;
let chatroomInstance: ChatroomInstance | null = null;
let connectionState: ConnectionState = "disconnected";
let chatRoomState: ChatRoomState = "none";
let chatroomConnected = false;
let currentChatroomId: string | null = null;
let loginSessionId = 0;
let nimAccount = "";
let signalingChannel: NimSignalingChannel | null = null;

let imEnterCallback: Callback | null = null;
export let chatRoomMsgCallback: Callback | null = null;

export const imState: { connected: boolean; chatRoomId: string | null } = {
  connected: false,
  chatRoomId: null,
};

// ===== SDK Loader =====

async function getSDK(): Promise<NimSDK> {
  if (SDK) return SDK;

  try {
    const module = await import("@yxim/nim-web-sdk");
    SDK = module as unknown as NimSDK;
    console.log("[YunxinIM] NIM SDK loaded via static import");
    return SDK;
  } catch (e) {
    console.error("[YunxinIM] Failed to load NIM SDK:", e);
    throw e;
  }
}

// ===== Helpers =====

function setConnectionState(nextState: ConnectionState) {
  connectionState = nextState;
  imState.connected = nextState === "connected";
}

function setChatRoomState(nextState: ChatRoomState, chatRoomId: string | null) {
  chatRoomState = nextState;
  imState.chatRoomId = chatRoomId;
  currentChatroomId = chatRoomId;
}

function resetIMState() {
  setConnectionState("disconnected");
  setChatRoomState("none", null);
}

function buildEnterResult(): YunxinPayload {
  return {
    code: 200,
    chatRoomId: currentChatroomId,
  };
}

function notifyMainChatroomConnected() {
  ipcRenderer.send(IPC.LT_CHATROOM_CONNECTED);
}

function notifyMainChatroomLeave() {
  ipcRenderer.send(IPC.NIM_LEAVE_CHATROOM);
}

// ===== IM Management =====

function destroyIMInstance() {
  if (nimInstance) {
    try {
      nimInstance.destroy({});
    } catch (e) {
      console.warn("[YunxinIM] destroy IM instance error:", e);
    }
    nimInstance = null;
  }
  chatroomConnected = false;
  signalingChannel = null;
  nimAccount = "";
}

async function initIMInstance(
  sdk: NimSDK,
  account: string,
  token: string
): Promise<NimInstance> {
  const existing = nimInstance;
  if (existing && nimAccount === account) {
    console.log("[YunxinIM] reusing existing NIM instance, account:", account);
    return existing;
  }

  if (existing) {
    console.log("[YunxinIM] destroying previous NIM instance, account changed:", nimAccount, "->", account);
    destroyIMInstance();
  }

  return new Promise<NimInstance>((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        destroyIMInstance();
        reject(new Error("NIM connect timeout"));
      }
    }, 15000);

    const instance = sdk.NIM.getInstance({
      appKey: NIM_APP_KEY,
      account,
      token,
      db: false,
      syncRelations: false,
      syncFriends: false,
      syncFriendUsers: false,
      syncTeams: false,
      syncExtraTeamInfo: false,
      syncSuperTeams: false,
      syncSessionUnread: false,
      logLevel: "warn",
      onconnect: () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        console.log("[YunxinIM] NIM connected:", account);
        nimInstance = instance;
        nimAccount = account;
        setConnectionState("connected");
        resolve(instance);
      },
      ondisconnect: (e: unknown) => {
        console.warn("[YunxinIM] NIM disconnected:", (e as Record<string, unknown>)?.code);
        setConnectionState("disconnected");
      },
      onerror: (e: unknown) => {
        console.warn("[YunxinIM] NIM error:", e);
        if (!done && !nimInstance) {
          done = true;
          clearTimeout(timeout);
          reject(e instanceof Error ? e : new Error("NIM connection error"));
        }
      },
      onwillreconnect: (e: unknown) => {
        const info = e as Record<string, unknown> | undefined;
        console.warn("[YunxinIM] NIM will reconnect, retry:", info?.retryCount, "duration:", info?.duration);
      },
    });
  });
}

// ===== Chatroom Management =====

function destroyChatroomInstance() {
  if (chatroomInstance) {
    try {
      chatroomInstance.disconnect({});
    } catch (e) {
      console.warn("[YunxinIM] disconnect chatroom error:", e);
    }
    chatroomInstance = null;
  }
  chatroomConnected = false;
  currentChatroomId = null;
  setChatRoomState("none", null);
}

async function initChatroomInstance(
  sdk: NimSDK,
  chatroomId: string,
  addresses: string[]
): Promise<ChatroomInstance> {
  destroyChatroomInstance();
  setChatRoomState("entering", chatroomId);
  currentChatroomId = chatroomId;

  return new Promise<ChatroomInstance>((resolve, reject) => {
    const chatroomOptions: Record<string, unknown> = {
      appKey: NIM_APP_KEY,
      chatroomId,
      isAnonymous: true,
      chatroomNick: "listen_together_user",
      logLevel: "warn",
      onconnect: () => {
        console.log("[YunxinIM] chatroom connected:", chatroomId);
        chatroomConnected = true;
        setChatRoomState("entered", chatroomId);
        notifyMainChatroomConnected();
        resolve(chatroom);
      },
      ondisconnect: (e: unknown) => {
        console.warn("[YunxinIM] chatroom disconnected:", (e as Record<string, unknown>)?.code);
        chatroomConnected = false;
        setChatRoomState("none", null);
        notifyMainChatroomLeave();
      },
      onerror: (e: unknown) => {
        console.error("[YunxinIM] chatroom error:", (e as Record<string, unknown>)?.code, e);
        if (!chatroomConnected) {
          reject(e instanceof Error ? e : new Error("Chatroom connection error"));
        }
      },
      onwillreconnect: (e: unknown) => {
        const info = e as Record<string, unknown> | undefined;
        console.warn("[YunxinIM] chatroom reconnecting, retry:", info?.retryCount, "duration:", info?.duration);
      },
      onmsgs: (msgs: Array<Record<string, unknown>>) => {
        for (const msg of msgs) {
          try {
            ipcRenderer.send(
              "channel.call",
              "nim.msg",
              JSON.stringify(msg)
            );
          } catch {
            // Drop silently if renderer isn't ready
          }
        }
      },
    };

    if (addresses.length > 0) {
      chatroomOptions.chatroomAddresses = addresses;
    }

    const chatroom = sdk.Chatroom.getInstance(chatroomOptions);
    chatroomInstance = chatroom;

    if (chatroom && typeof (chatroom as unknown as { connect?: () => void }).connect === "function") {
      setTimeout(() => {
        if (!chatroomConnected && currentChatroomId === chatroomId) {
          try {
            console.log("[YunxinIM] chatroom connect retry:", chatroomId);
            chatroom.connect();
          } catch (e) {
            console.warn("[YunxinIM] chatroom connect retry failed:", e);
          }
        }
      }, 1000);
    }
  });
}

// ===== Message Sending =====

export function sendChatroomText(text: string): boolean {
  if (!chatroomInstance || !chatroomConnected) {
    console.warn("[YunxinIM] sendChatroomText: chatroom not connected");
    return false;
  }

  try {
    chatroomInstance.sendText({
      text,
      done: (err: unknown) => {
        if (err) {
          console.warn("[YunxinIM] sendText error:", err);
        }
      },
    });
    return true;
  } catch (e) {
    console.warn("[YunxinIM] sendText threw:", e);
    return false;
  }
}

export function dispatchChatRoomMsg(msg: YunxinPayload) {
  if (!chatRoomMsgCallback) {
    console.log("[YunxinIM] chat room message ignored, callback not registered");
    return;
  }
  chatRoomMsgCallback(msg);
}

// ===== Signaling Management =====

async function createSignalingChannel(
  nim: NimInstance,
  channelName: string,
  roomId: string
): Promise<void> {
  if (signalingChannel && signalingChannel.channelName === channelName) {
    console.log("[YunxinIM] signaling channel already exists:", channelName);
    return;
  }

  try {
    const channel = await nim.signalingCreateAndJoin({
      type: 3,
      channelName,
      ext: JSON.stringify({ source: "open-orpheus", roomId }),
      attachExt: JSON.stringify({ source: "open-orpheus", roomId }),
      offlineEnabled: false,
    }).catch((err: unknown) => {
      console.warn("[YunxinIM] signalingCreateAndJoin failed, trying get/join:", err);
      return nim.signalingGetChannelInfo({ channelName }).then((info) => {
        if (!info || !info.channelId) throw err;
        return nim.signalingJoin({
          channelId: info.channelId,
          offlineEnabled: false,
        });
      });
    });

    signalingChannel = channel;
    console.log("[YunxinIM] signaling channel ready:", (channel as NimSignalingChannel).channelId, channelName);
  } catch (e) {
    console.warn("[YunxinIM] signaling setup failed, continuing without signaling:", e);
  }
}

// ===== IPC Listeners (main -> preload) =====

ipcRenderer.on(IPC.NIM_CLEANUP, () => {
  console.log("[YunxinIM] received cleanup command from main");
  destroyChatroomInstance();
  destroyIMInstance();
  resetIMState();
  loginSessionId++;
});

ipcRenderer.on(IPC.NIM_SEND_PLAY_COMMAND, (_event, text: string) => {
  console.log("[YunxinIM] received play command from main");
  sendChatroomText(text);
});

ipcRenderer.on(IPC.NIM_JOIN_CHATROOM, (_event, chatroomId: string, userId: string) => {
  console.log("[YunxinIM] received joinChatroom from main:", chatroomId);
  if (typeof chatroomId === "string" && chatroomId) {
    performLoginIM(chatroomId, userId).catch((e) => {
      console.warn("[YunxinIM] auto-join chatroom failed:", e);
    });
  }
});

// ===== Core Login Flow =====

export async function performLoginIM(
  chatRoomId: string,
  userId?: string
): Promise<{ code: number; chatRoomId: string }> {
  const currentSession = ++loginSessionId;
  setConnectionState("connecting");
  setChatRoomState("entering", chatRoomId);

  try {
    const sdk = await getSDK();

    const tokenResult = await ipcRenderer.invoke(IPC.NIM_GET_LISTEN_TOGETHER_TOKEN) as {
      code: number;
      data?: {
        imToken?: string;
        imAccId?: string;
        imUid?: string;
      };
    };

    if (loginSessionId !== currentSession) {
      console.log("[YunxinIM] loginIM stale session, aborting");
      return { code: -1, chatRoomId };
    }

    if (tokenResult.code !== 200 || !tokenResult.data?.imToken) {
      console.warn("[YunxinIM] loginIM: token not available");
      return { code: -1, chatRoomId };
    }

    const account = String(tokenResult.data.imAccId || tokenResult.data.imUid || "");
    const token = String(tokenResult.data.imToken || "");

    if (!account || !token) {
      console.warn("[YunxinIM] loginIM: account or token empty");
      return { code: -1, chatRoomId };
    }

    await initIMInstance(sdk, account, token);

    if (loginSessionId !== currentSession) {
      console.log("[YunxinIM] loginIM stale session after IM connect, aborting");
      return { code: -1, chatRoomId };
    }

    const addrResult = await ipcRenderer.invoke(
      IPC.NIM_GET_CHATROOM_ADDR,
      chatRoomId,
      userId || ""
    ) as { addresses?: string[] };

    const addresses: string[] = Array.isArray(addrResult?.addresses)
      ? addrResult.addresses
      : [];
    console.log("[YunxinIM] got", addresses.length, "chatroom addresses");

    if (loginSessionId !== currentSession) {
      console.log("[YunxinIM] loginIM stale session after addr fetch, aborting");
      return { code: -1, chatRoomId };
    }

    await initChatroomInstance(sdk, chatRoomId, addresses);

    if (loginSessionId !== currentSession) {
      console.log("[YunxinIM] loginIM stale session after chatroom connect, aborting");
      return { code: -1, chatRoomId };
    }

    setConnectionState("connected");
    console.log("[YunxinIM] IM connected");

    setChatRoomState("entered", chatRoomId);
    console.log("[YunxinIM] chat room entered, chatRoomId:", chatRoomId);

    ipcRenderer.send(IPC.NIM_JOIN_CHATROOM, chatRoomId, userId || "");

    const result = { code: 200, chatRoomId };
    if (imEnterCallback) {
      console.log("[YunxinIM] firing subscribeYunXinIMEnter callback");
      imEnterCallback(result);
    }
    return result;
  } catch (e) {
    console.error("[YunxinIM] loginIM error:", e);
    return { code: -1, chatRoomId };
  }
}

// ===== ContextBridge API =====

contextBridge.exposeInMainWorld("YunxinIM", {
  get logged() {
    return imState.connected;
  },

  loginIM: async (chatRoomId: string, userId?: string | number) => {
    console.log("[YunxinIM] loginIM called, chatRoomId:", chatRoomId);
    return performLoginIM(chatRoomId, userId ? String(userId) : undefined);
  },

  logout: () => {
    console.log("[YunxinIM] logout called");
    loginSessionId++;
    destroyChatroomInstance();
    ipcRenderer.send(IPC.NIM_LEAVE_CHATROOM);
    resetIMState();
    return Promise.resolve({ code: 200 });
  },

  enterRTC: async (params: YunxinPayload) => {
    try {
      const channelName = String(params.channelId ?? "");
      const roomId = String(params.roomId ?? "");

      const tokenResult = await ipcRenderer.invoke(
        IPC.NIM_GET_LISTEN_TOGETHER_TOKEN,
        channelName,
        roomId
      );

      ipcRenderer.invoke(IPC.NIM_ENTER_RTC, params).catch((e) => {
        console.warn("[YunxinIM] enterRTC main signaling failed:", e);
      });

      if (nimInstance && channelName) {
        createSignalingChannel(nimInstance, channelName, roomId).catch((e) => {
          console.warn("[YunxinIM] signaling create failed:", e);
        });
      }

      return {
        code: 200,
        ...(tokenResult as YunxinPayload),
        data: {
          ...((tokenResult as YunxinPayload)?.data as YunxinPayload ?? {}),
          roomId: params.roomId ?? "",
          channelId: params.channelId ?? "",
          roomRTCType: params.roomRTCType ?? "yunxin",
        },
      };
    } catch (e) {
      console.warn("[YunxinIM] enterRTC failed:", e);
      return { code: -1, message: String(e) };
    }
  },

  leaveRTC: () => {
    console.log("[YunxinIM] leaveRTC called");
    return Promise.resolve({ code: 200 });
  },

  leaveIM: () => {
    console.log("[YunxinIM] leaveIM called");
    loginSessionId++;
    ipcRenderer.send(IPC.NIM_LEAVE_CHATROOM);
    setChatRoomState("none", null);
    return Promise.resolve({ code: 200 });
  },

  subscribeYunXinIMEnter: (callback: Callback) => {
    console.log("[YunxinIM] subscribeYunXinIMEnter registered");
    imEnterCallback = callback;
    if (connectionState === "connected" && chatRoomState === "entered") {
      callback(buildEnterResult());
    }
  },

  subscribeYunXinIMChatRoomMsg: (callback: Callback) => {
    console.log("[YunxinIM] subscribeYunXinIMChatRoomMsg registered");
    chatRoomMsgCallback = callback;
  },
});
