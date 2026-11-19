// iOS draws the keyboard over the app without resizing anything, so text fields near the bottom end
// up under it. Android resizes the window itself and web has no on-screen keyboard events.
import { useEffect, useState } from "react";
import { Dimensions, Keyboard, Platform } from "react-native";

/** The keyboard's top edge in window coordinates while it is open on iOS; otherwise null. */
export function useKeyboardTop(): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const change = Keyboard.addListener("keyboardWillChangeFrame", (event) => {
      const y = event.endCoordinates.screenY;
      setTop(y < Dimensions.get("window").height ? y : null);
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setTop(null));
    return () => {
      change.remove();
      hide.remove();
    };
  }, []);
  return top;
}
