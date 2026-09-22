import { useEffect, type PropsWithChildren } from "react";
import { MobileDeviceProvider, useMobileDevice, type MobileDeviceId } from "./Device";
import { KeyboardDock, KeyboardProvider, useKeyboard } from "./Keyboard";
import { PhoneFrame } from "./PhoneFrame";
import { HomeIndicator, StatusBar } from "./components";

export function MobileRuntime({ children }: PropsWithChildren) {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get("embed") === "1";
  const initialDeviceId: MobileDeviceId = params.get("platform") === "android" ? "pixel-10" : "iphone";

  return (
    <MobileDeviceProvider embedded={embedded} initialDeviceId={initialDeviceId}>
      <PhoneFrame embedded={embedded}>
        <KeyboardProvider nativeKeyboard={embedded}>
          <KeyboardPreview />
          {embedded ? null : <StatusBar />}
          <MobileAppViewport>{children}</MobileAppViewport>
          {embedded ? null : <HomeIndicator />}
          {embedded ? null : <KeyboardDock />}
        </KeyboardProvider>
      </PhoneFrame>
    </MobileDeviceProvider>
  );
}

function MobileAppViewport({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const keyboard = useKeyboard();

  return (
    <div
      className="mobile-app-viewport"
      data-keyboard-visible={keyboard.visible ? "true" : "false"}
      data-platform={device.platform}
      data-testid="mobile-app-viewport"
    >
      {children}
    </div>
  );
}

function KeyboardPreview() {
  const keyboard = useKeyboard();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("keyboard") === "1") {
      keyboard.show();
    }
  }, [keyboard]);

  return null;
}
