import { useRef } from "react";

export default function useLongPress(onLongPress, delay = 650) {
  const timerRef = useRef(null);
  const didLongPressRef = useRef(false);

  const clear = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return {
    onPointerDown: () => {
      clear();
      didLongPressRef.current = false;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        didLongPressRef.current = true;
        onLongPress();
      }, delay);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClickCapture: (event) => {
      if (!didLongPressRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      didLongPressRef.current = false;
    },
    onContextMenu: (event) => {
      event.preventDefault();
      clear();
      didLongPressRef.current = true;
      onLongPress();
    },
  };
}
