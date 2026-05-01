import { registerCallHandler } from "../calls";
import { enterOrJoinRtc, leaveListenTogether } from "../nim";

registerCallHandler<[], [boolean]>("rtc.leave", () => {
  leaveListenTogether("rtc.leave");
  return [true];
});

registerCallHandler<[Record<string, unknown>], [boolean]>(
  "rtc.enter",
  (event, params) => {
    enterOrJoinRtc("enter", event.sender, params);
    return [true];
  },
);

registerCallHandler<[Record<string, unknown>], [boolean]>(
  "rtc.join",
  (event, params) => {
    enterOrJoinRtc("join", event.sender, params);
    return [true];
  },
);

registerCallHandler<[], [boolean]>("rtc.mute", () => {
  return [true];
});

registerCallHandler<[], [boolean]>("rtc.unmute", () => {
  return [true];
});

registerCallHandler<[boolean], [boolean]>("rtc.enableAudio", () => {
  return [true];
});

registerCallHandler<[Record<string, unknown>], [boolean]>(
  "rtc.setAudioProfile",
  () => {
    return [true];
  },
);
