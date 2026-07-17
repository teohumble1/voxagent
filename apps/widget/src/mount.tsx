import { createRoot, type Root } from "react-dom/client";
import { Widget, type WidgetOptions } from "./Widget";

export interface MountHandle {
  unmount(): void;
}

/**
 * Nhúng widget vào bất kỳ trang nào. Truyền một element có sẵn hoặc để trống để
 * tự tạo container gắn vào <body>.
 *
 *   VoxAgentWidget.mount({ endpoint: "http://localhost:8787" })
 */
export function mount(
  options: WidgetOptions & { target?: HTMLElement },
): MountHandle {
  const container = options.target ?? document.createElement("div");
  if (!options.target) document.body.appendChild(container);

  const root: Root = createRoot(container);
  root.render(<Widget endpoint={options.endpoint} title={options.title} accent={options.accent} />);

  return {
    unmount(): void {
      root.unmount();
      if (!options.target) container.remove();
    },
  };
}

// Cho phép gọi qua global khi nhúng bằng <script>: window.VoxAgentWidget.mount(...)
declare global {
  interface Window {
    VoxAgentWidget?: { mount: typeof mount };
  }
}
if (typeof window !== "undefined") {
  window.VoxAgentWidget = { mount };
}

export { Widget };
export type { WidgetOptions };
